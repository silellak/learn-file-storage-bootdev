import { respondWithJSON } from "./json";

import { type ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, UserForbiddenError } from "./errors";
import { getBearerToken, validateJWT } from "../auth";
import { getVideo, updateVideo } from "../db/videos";
import path from "node:path";
import { randomBytes } from "node:crypto";

const MAX_UPLOAD_SIZE = 1000 * 1024 * 1024; // 1GB
const LANDSCAPE_ASPECT_RATIO = 16 / 9;
const PORTRAIT_ASPECT_RATIO = 9 / 16;
const ASPECT_RATIO_TOLERANCE = 0.3;

export async function handlerUploadVideo(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);
  const videoData = getVideo(cfg.db, videoId);

  if (videoData?.userID != userID) {
    throw new UserForbiddenError("Invalid user for operation");
  }

  const formData = await req.formData();
  const video = formData.get("video");

  if (!video || !(video instanceof File)) {
    throw new BadRequestError("Invalid file format");
  }

  if (video.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size exceeds the maximum limit of 1GB");
  }

  const mediaType = video.type;

  if (mediaType != "video/mp4") {
    throw new BadRequestError("Invalid file format");
  }

  const videoFileId = `${videoId}.${video.type.split("/")[1]}`;

  const tempFilePath = path.join(`${cfg.assetsRoot}/temp/${videoFileId}`);

  await Bun.write(tempFilePath, await video.arrayBuffer());

  const tempFile = Bun.file(tempFilePath);

  const aspectRatio = await getVideoAspectRatio(tempFilePath);
  const videoFileKey= `${aspectRatio}/${videoFileId}`;

  cfg.s3Client.write(videoFileKey, tempFile, { type: mediaType });
  const videoURL = `https://${cfg.s3Bucket}.s3.${cfg.s3Region}.amazonaws.com/${videoFileKey}`;
  console.log(`Uploaded video to ${videoURL}`);
  videoData.videoURL = videoURL;
  updateVideo(cfg.db, videoData);
  
  await tempFile.delete();

  return respondWithJSON(200, { videoURL });
}

export async function getVideoAspectRatio(filePath: string): Promise<string> {
  const proc = Bun.spawn({
    cmd: ["ffprobe", "-v", "error", "-select_streams", "v:0", "-show_entries", "stream=width,height", "-of", "json", filePath],
    stdout: "pipe",
    stderr: "pipe",
  });
  const stdoutText = await new Response(proc.stdout).text();
  const stderrText = await new Response(proc.stderr).text();
  if (stderrText) {
    console.error(`ffprobe error: ${stderrText}`);
  }

  console.log(stdoutText);

  const { width, height } = JSON.parse(stdoutText).streams[0];

  console.log(`Width: ${width}, Height: ${height}`);
  
  const aspectRatio = width / height;
  console.log(`Aspect Ratio: ${aspectRatio}`);
  if (Math.abs(aspectRatio - LANDSCAPE_ASPECT_RATIO) <= ASPECT_RATIO_TOLERANCE) {
    return "landscape";
  } else if (Math.abs(aspectRatio - PORTRAIT_ASPECT_RATIO) <= ASPECT_RATIO_TOLERANCE) {
    return "portrait";
  } else {
    return "other";
  }
}