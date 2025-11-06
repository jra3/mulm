import {
  S3Client,
  PutObjectCommand,
  DeleteObjectCommand,
  GetObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import crypto from "crypto";
import { logger } from "./logger";
import configFile from "../config.json";

export interface R2Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  publicUrl?: string;
}

export interface ImageMetadata {
  key: string;
  url: string;
  size: number;
  uploadedAt: string;
  contentType?: string;
}

const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const ALLOWED_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];
const PRESIGNED_URL_EXPIRY = 300; // 5 minutes

let client: S3Client | null = null;
let config: R2Config | null = null;

export function initR2() {
  // Try environment variables first, then fall back to config.json
  const endpoint = process.env.R2_ENDPOINT || configFile.s3Url;
  const accessKeyId = process.env.R2_ACCESS_KEY_ID || configFile.s3AccessKeyId;
  const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY || configFile.s3Secret;
  const bucketName = process.env.R2_BUCKET_NAME || configFile.s3Bucket;
  const publicUrl = process.env.R2_PUBLIC_URL || configFile.r2PublicUrl;

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    logger.warn("R2 configuration not found. Image uploads will be disabled.");
    return false;
  }

  config = {
    endpoint,
    accessKeyId,
    secretAccessKey,
    bucketName,
    publicUrl,
  };

  client = new S3Client({
    region: "auto",
    endpoint: config.endpoint,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
  });

  logger.info("R2 client initialized");
  return true;
}

/**
 * Used only in testing to inject a mock S3 client
 */
export function overrideR2Client(mockClient: S3Client, mockConfig: R2Config) {
  client = mockClient;
  config = mockConfig;
}

function ensureInitialized(): S3Client {
  if (!client || !config) {
    throw new Error("R2 client not initialized. Call initR2() first.");
  }
  return client;
}

function getBucketName(): string {
  if (!config) {
    throw new Error("R2 client not initialized");
  }
  return config.bucketName;
}

export function generateImageKey(memberId: number, submissionId: number, filename: string): string {
  const timestamp = Date.now();
  const hash = crypto.randomBytes(8).toString("hex");
  const extension = filename.split(".").pop()?.toLowerCase() || "jpg";
  return `submissions/${memberId}/${submissionId}/${timestamp}-${hash}.${extension}`;
}

export async function getPresignedUploadUrl(
  key: string,
  contentType: string,
  contentLength?: number
): Promise<string> {
  const s3Client = ensureInitialized();

  if (!ALLOWED_MIME_TYPES.includes(contentType)) {
    throw new Error(
      `Invalid content type: ${contentType}. Allowed types: ${ALLOWED_MIME_TYPES.join(", ")}`
    );
  }

  if (contentLength && contentLength > MAX_FILE_SIZE) {
    throw new Error(
      `File size ${contentLength} exceeds maximum allowed size of ${MAX_FILE_SIZE} bytes`
    );
  }

  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    ContentType: contentType,
    ContentLength: contentLength,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: PRESIGNED_URL_EXPIRY });
  return url;
}

export async function getPresignedDownloadUrl(key: string): Promise<string> {
  const s3Client = ensureInitialized();

  const command = new GetObjectCommand({
    Bucket: getBucketName(),
    Key: key,
  });

  const url = await getSignedUrl(s3Client, command, { expiresIn: 3600 }); // 1 hour
  return url;
}

export async function deleteImage(key: string): Promise<void> {
  const s3Client = ensureInitialized();

  try {
    const command = new DeleteObjectCommand({
      Bucket: getBucketName(),
      Key: key,
    });

    await s3Client.send(command);
    logger.info(`Deleted image from R2: ${key}`);
  } catch (error) {
    logger.error("Failed to delete image from R2:", error);
    throw error;
  }
}

export async function deleteImages(keys: string[]): Promise<void> {
  await Promise.all(keys.map((key) => deleteImage(key)));
}

export function getPublicUrl(key: string): string {
  if (!config) {
    throw new Error("R2 client not initialized");
  }

  if (config.publicUrl) {
    return `${config.publicUrl}/${key}`;
  }

  // Fallback to endpoint URL if no custom domain configured
  return `${config.endpoint}/${config.bucketName}/${key}`;
}

export function validateContentType(contentType: string): boolean {
  return ALLOWED_MIME_TYPES.includes(contentType);
}

export function validateFileSize(size: number): boolean {
  return size > 0 && size <= MAX_FILE_SIZE;
}

export function isR2Enabled(): boolean {
  return client !== null && config !== null;
}

/**
 * Upload a buffer directly to R2
 */
export async function uploadToR2(key: string, buffer: Buffer, contentType: string): Promise<void> {
  const s3Client = ensureInitialized();

  const command = new PutObjectCommand({
    Bucket: getBucketName(),
    Key: key,
    Body: buffer,
    ContentType: contentType,
  });

  await s3Client.send(command);
  logger.info(`Uploaded to R2: ${key}`);
}
