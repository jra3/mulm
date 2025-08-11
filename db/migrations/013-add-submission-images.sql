-- Add support for image attachments to submissions
-- Images will be stored in Cloudflare R2, this column stores the metadata

ALTER TABLE submissions ADD COLUMN images TEXT DEFAULT NULL;
-- JSON array of image metadata: [{key: string, url: string, size: number, uploadedAt: string}]