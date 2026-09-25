import { getBearerToken, validateJWT } from "../auth";
import { respondWithJSON } from "./json";
import { getVideo, updateVideo } from "../db/videos";
import type { ApiConfig } from "../config";
import type { BunRequest } from "bun";
import { BadRequestError, NotFoundError, UserForbiddenError } from "./errors";
import path from "node:path";
import { randomBytes } from "node:crypto";

type Thumbnail = {
  data: ArrayBuffer;
  mediaType: string;
};

const MAX_UPLOAD_SIZE = 10 * 1024 * 1024; // 10MB

export async function handlerUploadThumbnail(cfg: ApiConfig, req: BunRequest) {
  const { videoId } = req.params as { videoId?: string };
  if (!videoId) {
    throw new BadRequestError("Invalid video ID");
  }

  const token = getBearerToken(req.headers);
  const userID = validateJWT(token, cfg.jwtSecret);

  console.log("uploading thumbnail for video", videoId, "by user", userID);

  const formData = await req.formData();
  const image = formData.get("thumbnail");

  if (!image || !(image instanceof File)) {
    throw new BadRequestError("Invalid file format");
  }

  const mediaType = image.type;

  if (mediaType !== "image/jpeg" && mediaType !== "image/png") {
    throw new BadRequestError("Invalid file type. Only JPEG or PNG allowed.");
  }

  if (image.size > MAX_UPLOAD_SIZE) {
    throw new BadRequestError("File size exceeds the maximum limit of 10MB");
  }

  const videoMetadata = getVideo(cfg.db, videoId);
  if (!videoMetadata) {
    throw new NotFoundError("Couldn't find video");
  }
  
  if (videoMetadata.userID !== userID) {
    throw new UserForbiddenError("You are not authorized to upload a thumbnail for this video");
  }

  const randomId = randomBytes(32).toString("base64url");

  const filePath = path.join(cfg.assetsRoot, `${randomId}.${image.type.split("/")[1]}`);
  console.log("Saving thumbnail to", filePath);
  Bun.write(filePath, await image.arrayBuffer());
  const thumbnailURL = `http://localhost:${cfg.port}/assets/${randomId}.${image.type.split("/")[1]}`;
  videoMetadata.thumbnailURL = thumbnailURL;

  // const mediaType = image.type;
  // const arrayBuffer = await image.arrayBuffer();
  // const buffer = Buffer.from(arrayBuffer);
  // const bufferString = buffer.toString("base64");
  // const dataUrl = `data:${mediaType};base64,${bufferString}`;
  // videoMetadata.thumbnailURL = dataUrl;

  updateVideo(cfg.db, videoMetadata);

  return respondWithJSON(200, { videoMetadata });
}
