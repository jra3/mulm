import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import config from '@/config.json';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';

const s3Client = new S3Client({
  region: 'auto',
  endpoint: config.s3Url,
  credentials: {
    accessKeyId: config.s3AccessKeyId,
    secretAccessKey: config.s3Secret,
  },
});

const BUCKET_NAME = 'mulm-photos';

export interface UploadResult {
	key: string;
	url: string;
}

export async function uploadPhoto(buffer: Buffer, originalname: string, mimetype: string): Promise<UploadResult> {
  const fileExtension = originalname.split('.').pop() || '';
  const key = `photos/${uuidv4()}.${fileExtension}`;
	
  try {
    const command = new PutObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
      Body: buffer,
      ContentType: mimetype,
    });

    await s3Client.send(command);
		
    const url = `${config.s3Url}/${BUCKET_NAME}/${key}`;
		
    logger.info(`Photo uploaded successfully: ${key}`);
    return { key, url };
  } catch (error) {
    logger.error('Failed to upload photo:', error);
    throw new Error('Failed to upload photo');
  }
}

export async function deletePhoto(key: string): Promise<void> {
  try {
    const command = new DeleteObjectCommand({
      Bucket: BUCKET_NAME,
      Key: key,
    });

    await s3Client.send(command);
    logger.info(`Photo deleted successfully: ${key}`);
  } catch (error) {
    logger.error('Failed to delete photo:', error);
    throw new Error('Failed to delete photo');
  }
}

export function getPhotoUrl(key: string): string {
  return `${config.s3Url}/${BUCKET_NAME}/${key}`;
}