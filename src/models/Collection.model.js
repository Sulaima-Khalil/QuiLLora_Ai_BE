import mongoose from 'mongoose';

const { Schema, model } = mongoose;

/**
 * A user-defined reading list — mirrors `collections[]` in collectionsStore.js.
 *
 * Plain bookmarks are NOT modelled here: they live on `User.bookmarks`, since
 * the frontend treats them as a single flat list rather than a collection.
 */
const collectionSchema = new Schema(
  {
    owner: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
      index: true,
    },

    name: {
      type: String,
      required: [true, 'Collection name is required'],
      trim: true,
      maxlength: [80, 'Collection name must be at most 80 characters'],
    },

    description: { type: String, trim: true, maxlength: 300, default: '' },

    articles: [{ type: Schema.Types.ObjectId, ref: 'Article' }],
  },
  {
    timestamps: true,
    toJSON: { virtuals: true },
    toObject: { virtuals: true },
  },
);

// One collection name per owner — the rename/create endpoints rely on this to
// reject duplicates at the database level rather than in a racy pre-check.
collectionSchema.index({ owner: 1, name: 1 }, { unique: true });

collectionSchema.virtual('articleCount').get(function articleCount() {
  return this.articles?.length ?? 0;
});

export const Collection = model('Collection', collectionSchema);

export default Collection;
