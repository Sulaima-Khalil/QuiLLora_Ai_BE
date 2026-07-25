import fs from 'node:fs';
import path from 'node:path';
import multer from 'multer';
import config from '../config/env.js';
import { UPLOAD } from '../constants/index.js';
import ApiError from '../utils/ApiError.js';
import { randomId } from '../helpers/crypto.helper.js';

/** Creates the destination directory on first use. */
const ensureDir = (dir) => {
  fs.mkdirSync(dir, { recursive: true });
  return dir;
};

const buildStorage = (subdirectory) =>
  multer.diskStorage({
    destination(_req, _file, cb) {
      try {
        cb(null, ensureDir(path.join(config.uploads.dir, subdirectory)));
      } catch (error) {
        cb(error);
      }
    },
    filename(_req, file, cb) {
      // The original name is discarded: it is attacker-controlled and a path
      // traversal risk. Only the validated extension is preserved.
      const extension = path.extname(file.originalname).toLowerCase().slice(0, 10);
      const safeExtension = /^\.[a-z0-9]+$/.test(extension) ? extension : '';
      cb(null, `${Date.now()}-${randomId(8)}${safeExtension}`);
    },
  });

const imageFileFilter = (_req, file, cb) => {
  if (UPLOAD.ALLOWED_MIME_TYPES.includes(file.mimetype)) {
    cb(null, true);
    return;
  }

  cb(
    ApiError.badRequest(
      `Unsupported file type '${file.mimetype}'. Allowed: ${UPLOAD.ALLOWED_MIME_TYPES.join(', ')}`,
    ),
  );
};

const buildUploader = (subdirectory) =>
  multer({
    storage: buildStorage(subdirectory),
    fileFilter: imageFileFilter,
    limits: { fileSize: UPLOAD.MAX_FILE_SIZE_BYTES, files: 1 },
  });

/** `multipart/form-data` field `coverImage` on article routes. */
export const uploadArticleCover = buildUploader('articles');

/** `multipart/form-data` field `avatar` on profile routes. */
export const uploadAvatar = buildUploader('avatars');

/** Public URL for a stored upload, e.g. `/uploads/avatars/1699-ab12.png`. */
export const toPublicUrl = (file, subdirectory) =>
  file ? `${config.uploads.publicPath}/${subdirectory}/${file.filename}` : '';

/** Best-effort removal of a superseded upload. Never throws. */
export const removeUpload = async (publicUrl) => {
  if (!publicUrl?.startsWith(`${config.uploads.publicPath}/`)) return;

  const relative = publicUrl.slice(config.uploads.publicPath.length + 1);
  const target = path.resolve(config.uploads.dir, relative);

  // Guard against `../` escaping the uploads root.
  if (!target.startsWith(path.resolve(config.uploads.dir))) return;

  await fs.promises.rm(target, { force: true }).catch(() => {});
};

export default { uploadArticleCover, uploadAvatar, toPublicUrl, removeUpload };
