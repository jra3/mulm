import multer from "multer";

export const MAX_IMAGE_FILE_SIZE = 20 * 1024 * 1024;
export const IMAGE_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"];

export function createImageUpload(maxFiles: number) {
  return multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: MAX_IMAGE_FILE_SIZE, files: maxFiles },
    fileFilter: (_req, file, cb) => {
      if (IMAGE_MIME_TYPES.includes(file.mimetype)) cb(null, true);
      else cb(new Error("Invalid file type. Only JPEG, PNG, and WebP images are allowed."));
    },
  });
}
