import { S3Client, PutObjectCommand, DeleteObjectCommand } from '@aws-sdk/client-s3';
import config from '@/config.json';
import { v4 as uuidv4 } from 'uuid';
import { logger } from '@/utils/logger';
import sharp from 'sharp';

const s3Client = new S3Client({
	region: 'auto',
	endpoint: config.s3Url,
	credentials: {
		accessKeyId: config.s3AccessKeyId,
		secretAccessKey: config.s3Secret,
	},
});

export interface UploadResult {
	key: string;
	url: string;
}

export interface ProcessedImage {
	original: Buffer;
	thumbnail: Buffer;
	display: Buffer;
	format: string;
	metadata: {
		width: number;
		height: number;
		size: number;
	};
}

export interface UploadedImages {
	original: {
		key: string;
		url: string;
		width: number;
		height: number;
	};
	display: {
		key: string;
		url: string;
	};
	thumbnail: {
		key: string;
		url: string;
	};
}

export async function uploadPhoto(buffer: Buffer, originalname: string, mimetype: string): Promise<UploadResult> {
	const fileExtension = originalname.split('.').pop() || '';
	const key = `photos/${uuidv4()}.${fileExtension}`;

	try {
		const command = new PutObjectCommand({
			Bucket: config.s3Bucket,
			Key: key,
			Body: buffer,
			ContentType: mimetype,
		});

		await s3Client.send(command);

		const url = `${config.s3Url}/${config.s3Bucket}/${key}`;

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
			Bucket: config.s3Bucket,
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
	return `${config.r2PublicUrl}/${key}`;
}

async function processImage(inputBuffer: Buffer): Promise<ProcessedImage> {
	try {
		// Get original image metadata
		const metadata = await sharp(inputBuffer).metadata();
		
		if (!metadata.width || !metadata.height) {
			throw new Error('Invalid image - no dimensions');
		}
		
		// Validate image isn't suspiciously large (decompression bomb protection)
		const uncompressedSize = metadata.width * metadata.height * (metadata.channels || 3);
		if (uncompressedSize > 100 * 1024 * 1024) { // 100MB uncompressed
			throw new Error('Image would be too large when decompressed');
		}
		
		// Convert to JPEG and apply auto-rotation based on EXIF
		const pipeline = sharp(inputBuffer)
			.rotate() // Auto-rotate based on EXIF orientation
			.jpeg({ quality: 85 });
		
		// Process original (resize if needed)
		let originalProcessed = pipeline.clone();
		
		// Only resize if larger than max dimensions (1920x1080)
		if (metadata.width > 1920 || metadata.height > 1080) {
			originalProcessed = originalProcessed.resize(1920, 1080, {
				fit: 'inside',
				withoutEnlargement: true
			});
		}
		
		const original = await originalProcessed.toBuffer();
		
		// Create display version (medium size for web display)
		const display = await pipeline.clone()
			.resize(1200, 800, {
				fit: 'inside',
				withoutEnlargement: true
			})
			.toBuffer();
		
		// Create thumbnail (square crop)
		const thumbnail = await pipeline.clone()
			.resize(300, 300, {
				fit: 'cover',
				position: 'center'
			})
			.jpeg({ quality: 75 })
			.toBuffer();
		
		// Get final metadata
		const finalMetadata = await sharp(original).metadata();
		
		return {
			original,
			thumbnail,
			display,
			format: 'jpeg',
			metadata: {
				width: finalMetadata.width ?? 0,
				height: finalMetadata.height ?? 0,
				size: original.length
			}
		};
	} catch (error) {
		logger.error('Image processing failed:', error);
		throw new Error('Failed to process image');
	}
}

export async function uploadProcessedPhoto(
	buffer: Buffer,
	originalname: string,
	submissionId: number
): Promise<UploadedImages> {
	// Validate it's actually an image using Sharp
	try {
		const metadata = await sharp(buffer).metadata();
		const supportedFormats = ['jpeg', 'png', 'gif', 'webp'];
		if (!metadata.format || !supportedFormats.includes(metadata.format)) {
			throw new Error(`Unsupported image format: ${metadata.format}`);
		}
	} catch (error) {
		logger.error('Image validation failed:', error);
		throw new Error('Invalid image file');
	}
	
	// Process the image
	const processedImage = await processImage(buffer);
	const baseKey = `submissions/${submissionId}/${uuidv4()}`;
	
	try {
		// Upload all three versions
		const uploads = await Promise.all([
			// Original (processed)
			uploadToR2(
				`${baseKey}_original.jpg`,
				processedImage.original,
				'image/jpeg'
			),
			// Display version
			uploadToR2(
				`${baseKey}_display.jpg`,
				processedImage.display,
				'image/jpeg'
			),
			// Thumbnail
			uploadToR2(
				`${baseKey}_thumb.jpg`,
				processedImage.thumbnail,
				'image/jpeg'
			)
		]);
		
		return {
			original: {
				key: uploads[0].key,
				url: uploads[0].url,
				width: processedImage.metadata.width,
				height: processedImage.metadata.height
			},
			display: {
				key: uploads[1].key,
				url: uploads[1].url
			},
			thumbnail: {
				key: uploads[2].key,
				url: uploads[2].url
			}
		};
	} catch (error) {
		logger.error('Failed to upload processed images:', error);
		throw new Error('Failed to upload images');
	}
}

async function uploadToR2(
	key: string,
	buffer: Buffer,
	contentType: string
): Promise<{ key: string; url: string }> {
	const command = new PutObjectCommand({
		Bucket: config.s3Bucket,
		Key: key,
		Body: buffer,
		ContentType: contentType,
		CacheControl: 'public, max-age=31536000'
	});
	
	await s3Client.send(command);
	
	return {
		key,
		url: `${config.s3Url}/${config.s3Bucket}/${key}`
	};
}

// Delete all versions of an image
export async function deleteProcessedPhoto(baseKey: string): Promise<void> {
	const keys = [
		`${baseKey}_original.jpg`,
		`${baseKey}_display.jpg`,
		`${baseKey}_thumb.jpg`
	];
	
	await Promise.all(
		keys.map(async (key) => {
			try {
				await deletePhoto(key);
			} catch {
				// Ignore errors - file might not exist
			}
		})
	);
}
