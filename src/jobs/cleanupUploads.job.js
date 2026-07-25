import fs from 'node:fs';
import path from 'node:path';
import config from '../config/env.js';
import { Article, User } from '../models/index.js';
import logger from '../utils/logger.js';

/**
 * Deletes uploaded files no document references any more.
 *
 * Orphans accumulate when a request fails after multer has written the file
 * but before the document was saved. Files newer than `minAgeHours` are
 * skipped so an upload still mid-request is never removed.
 */
export const cleanupOrphanedUploads = async ({ minAgeHours = 24 } = {}) => {
  const cutoff = Date.now() - minAgeHours * 60 * 60 * 1000;
  let removed = 0;

  try {
    // Collect every referenced path first, so a file is only deleted when no
    // document anywhere points at it.
    const [articles, users] = await Promise.all([
      Article.find({ coverImage: { $ne: '' } }).select('coverImage').lean().exec(),
      User.find({ avatar: { $ne: '' } }).select('avatar').lean().exec(),
    ]);

    const referenced = new Set([
      ...articles.map((article) => article.coverImage),
      ...users.map((user) => user.avatar),
    ]);

    for (const subdirectory of ['articles', 'avatars']) {
      const directory = path.join(config.uploads.dir, subdirectory);
      if (!fs.existsSync(directory)) continue;

      const entries = await fs.promises.readdir(directory);

      for (const entry of entries) {
        const publicUrl = `${config.uploads.publicPath}/${subdirectory}/${entry}`;
        if (referenced.has(publicUrl)) continue;

        const filePath = path.join(directory, entry);
        const stats = await fs.promises.stat(filePath).catch(() => null);

        if (!stats?.isFile() || stats.mtimeMs > cutoff) continue;

        await fs.promises.rm(filePath, { force: true }).catch(() => {});
        removed += 1;
      }
    }

    if (removed > 0) logger.info(`Upload cleanup: removed ${removed} orphaned file(s)`);

    return removed;
  } catch (error) {
    logger.error(`Upload cleanup failed: ${error.message}`);
    return removed;
  }
};

export default cleanupOrphanedUploads;
