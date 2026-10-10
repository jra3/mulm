// Entry point run by start.sh on staging after a DB restore:
//   node src/staging/mirror-images.js
// Copies prod's image bucket into staging's using the read-only
// PROD_R2_READ_* key. Staging's own bucket and key come from config.json.
import { S3Client } from "@aws-sdk/client-s3";
import config from "../config.json";
import { logger } from "../utils/logger";
import { isStaging } from "../utils/environment";
import { mirrorBucket } from "./mirrorImages";

const PROD_BUCKET = process.env.PROD_R2_BUCKET || "basny-bap-data";

async function main() {
  if (!isStaging()) {
    throw new Error("mirror-images only runs on staging (STAGING=1)");
  }
  const accessKeyId = process.env.PROD_R2_READ_ACCESS_KEY_ID;
  const secretAccessKey = process.env.PROD_R2_READ_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) {
    throw new Error("PROD_R2_READ_ACCESS_KEY_ID / PROD_R2_READ_SECRET_ACCESS_KEY not set");
  }

  const endpoint = config.storage.s3Url;
  const client = (credentials: { accessKeyId: string; secretAccessKey: string }) =>
    new S3Client({ region: "auto", endpoint, credentials });

  const result = await mirrorBucket(
    { client: client({ accessKeyId, secretAccessKey }), bucket: PROD_BUCKET },
    {
      client: client({
        accessKeyId: config.storage.s3AccessKeyId,
        secretAccessKey: config.storage.s3Secret,
      }),
      bucket: config.storage.s3Bucket,
    }
  );
  logger.info(
    `Image mirror done: ${result.copied} copied, ${result.removed} removed, ${result.failed} failed`
  );
  if (result.failed > 0) process.exitCode = 1;
}

main().catch((err: unknown) => {
  logger.error("Image mirror failed", err);
  process.exitCode = 1;
});
