import crypto from "node:crypto";
import { processImage } from "../utils/image-processor";
import { deleteImage, getPublicUrl, uploadToR2, type ImageMetadata } from "../utils/r2-client";
import { logger } from "../utils/logger";

export interface MediaStorage {
  put(key: string, buffer: Buffer, contentType: string): Promise<void>;
  delete(key: string): Promise<void>;
  publicUrl(key: string): string;
}

interface MediaLocation {
  scope: "submissions" | "cares";
  memberId: number;
  recordId: number;
  filename: string;
}

export interface UploadedMedia {
  metadata: ImageMetadata;
  keys: string[];
  /** Best effort compensation; failures are logged without masking the original error. */
  cleanup(): Promise<void>;
}

export function imageVariantKeys(originalKey: string): string[] {
  return [
    originalKey,
    originalKey.replace("-original", "-medium"),
    originalKey.replace("-original", "-thumb"),
  ];
}

export function createMediaService({
  storage,
  now = () => new Date(),
  key = (location: MediaLocation) => {
    const extension = location.filename.split(".").pop()?.toLowerCase() || "jpg";
    return `${location.scope}/${location.memberId}/${location.recordId}/${now().getTime()}-${crypto.randomBytes(8).toString("hex")}.${extension}`;
  },
}: {
  storage: MediaStorage;
  now?: () => Date;
  key?: (location: MediaLocation) => string;
}) {
  async function cleanup(keys: string[]): Promise<void> {
    await Promise.all(
      keys.map(async (ownedKey) => {
        try {
          await storage.delete(ownedKey);
        } catch (error) {
          logger.error("Failed to clean up image variant", { key: ownedKey, error });
        }
      })
    );
  }

  async function upload(
    buffer: Buffer,
    location: MediaLocation,
    options: { preferWebP?: boolean; onUploading?: () => void } = {}
  ): Promise<UploadedMedia> {
    const processed = await processImage(buffer, options);
    const baseKey = key(location);
    // Keep existing recognized extensions; give extensionless uploads distinct variants too.
    const stem = baseKey.replace(/\.(jpg|jpeg|png|webp)$/i, "");
    const extension = baseKey.slice(stem.length) || `.${processed.original.format}`;
    const keys = ["original", "medium", "thumb"].map((size) => `${stem}-${size}${extension}`);
    const variants = [processed.original, processed.medium, processed.thumbnail];
    // Build metadata before writing so even a URL/clock provider failure owns no objects.
    const metadata: ImageMetadata = {
      key: keys[0],
      url: storage.publicUrl(keys[0]),
      size: processed.original.size,
      uploadedAt: now().toISOString(),
      contentType: `image/${processed.original.format}`,
    };
    options.onUploading?.();
    const results = await Promise.allSettled(
      keys.map(async (ownedKey, i) => {
        await storage.put(ownedKey, variants[i].buffer, `image/${variants[i].format}`);
      })
    );
    const failed = results.find((result) => result.status === "rejected");
    if (failed?.status === "rejected") {
      // Include attempted keys: a request can fail after storage accepted its write.
      // All started writes have settled, so no sibling can recreate an object after deletion.
      await cleanup(keys);
      throw failed.reason;
    }
    return { metadata, keys, cleanup: () => cleanup(keys) };
  }

  return { upload, cleanup };
}

export const media = createMediaService({
  storage: { put: uploadToR2, delete: deleteImage, publicUrl: getPublicUrl },
});
