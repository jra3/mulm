import {
  S3Client,
  ListObjectsV2Command,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectsCommand,
} from "@aws-sdk/client-s3";
import { logger } from "../utils/logger";

// Staging mirrors prod's image bucket into its own, so a refreshed staging DB
// finds the images it references without staging ever holding a prod write
// key. Source is read with a read-only token; destination is staging's bucket.

export interface BucketObject {
  key: string;
  size: number;
  etag: string;
}

export interface MirrorPlan {
  copy: string[];
  remove: string[];
}

export interface BucketRef {
  client: S3Client;
  bucket: string;
}

/** Objects missing from dest or differing in size/etag get copied; dest-only objects get removed. */
export function planMirror(source: BucketObject[], dest: BucketObject[]): MirrorPlan {
  const destByKey = new Map(dest.map((o) => [o.key, o]));
  const sourceKeys = new Set(source.map((o) => o.key));
  const copy = source
    .filter((o) => {
      const d = destByKey.get(o.key);
      return !d || d.size !== o.size || d.etag !== o.etag;
    })
    .map((o) => o.key);
  const remove = dest.filter((o) => !sourceKeys.has(o.key)).map((o) => o.key);
  return { copy, remove };
}

async function listAll({ client, bucket }: BucketRef): Promise<BucketObject[]> {
  const objects: BucketObject[] = [];
  let token: string | undefined;
  do {
    const page = await client.send(
      new ListObjectsV2Command({ Bucket: bucket, ContinuationToken: token })
    );
    for (const o of page.Contents ?? []) {
      if (o.Key) objects.push({ key: o.Key, size: o.Size ?? 0, etag: o.ETag ?? "" });
    }
    token = page.IsTruncated ? page.NextContinuationToken : undefined;
  } while (token);
  return objects;
}

async function copyObject(source: BucketRef, dest: BucketRef, key: string): Promise<void> {
  const obj = await source.client.send(new GetObjectCommand({ Bucket: source.bucket, Key: key }));
  if (!obj.Body) throw new Error(`empty body for ${key}`);
  const body = await obj.Body.transformToByteArray();
  await dest.client.send(
    new PutObjectCommand({
      Bucket: dest.bucket,
      Key: key,
      Body: body,
      ContentType: obj.ContentType,
      CacheControl: obj.CacheControl,
    })
  );
}

async function inBatches<T>(items: T[], size: number, fn: (item: T) => Promise<void>) {
  for (let i = 0; i < items.length; i += size) {
    await Promise.all(items.slice(i, i + size).map(fn));
  }
}

export async function mirrorBucket(
  source: BucketRef,
  dest: BucketRef
): Promise<{ copied: number; removed: number; failed: number }> {
  if (source.bucket === dest.bucket) {
    throw new Error(`refusing to mirror ${source.bucket} onto itself`);
  }

  const [sourceObjects, destObjects] = await Promise.all([listAll(source), listAll(dest)]);
  const plan = planMirror(sourceObjects, destObjects);
  logger.info(
    `Mirroring ${source.bucket} → ${dest.bucket}: ${plan.copy.length} to copy, ${plan.remove.length} to remove`
  );

  let copyFailed = 0;
  await inBatches(plan.copy, 8, async (key) => {
    try {
      await copyObject(source, dest, key);
    } catch (err) {
      copyFailed++;
      logger.warn(`Failed to copy ${key}`, err);
    }
  });

  // DeleteObjects takes up to 1000 keys per call, and reports a key it could
  // not delete in Errors rather than rejecting the whole call.
  let removed = 0;
  let removeFailed = 0;
  for (let i = 0; i < plan.remove.length; i += 1000) {
    const batch = plan.remove.slice(i, i + 1000);
    try {
      const result = await dest.client.send(
        new DeleteObjectsCommand({
          Bucket: dest.bucket,
          Delete: { Objects: batch.map((Key) => ({ Key })) },
        })
      );
      const errors = result.Errors ?? [];
      for (const e of errors) {
        logger.warn(`Failed to remove ${e.Key}`, { code: e.Code, message: e.Message });
      }
      removeFailed += errors.length;
      removed += batch.length - errors.length;
    } catch (err) {
      removeFailed += batch.length;
      logger.warn(`Failed to remove ${batch.length} objects`, err);
    }
  }

  return { copied: plan.copy.length - copyFailed, removed, failed: copyFailed + removeFailed };
}
