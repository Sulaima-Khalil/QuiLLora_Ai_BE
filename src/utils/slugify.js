/**
 * URL-safe slug from arbitrary text.
 * Strips diacritics so "Café Design" becomes "cafe-design".
 */
export const slugify = (value) =>
  String(value ?? '')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80);

/**
 * Slug guaranteed unique within a collection.
 *
 * @param {string} value Source text.
 * @param {(slug: string) => Promise<boolean>} exists Resolves true if taken.
 */
export const uniqueSlug = async (value, exists) => {
  const base = slugify(value) || 'untitled';

  if (!(await exists(base))) return base;

  // Bounded probing keeps this O(1)-ish for realistic collision counts;
  // the random suffix guarantees termination for pathological cases.
  for (let suffix = 2; suffix <= 50; suffix += 1) {
    const candidate = `${base}-${suffix}`;
    if (!(await exists(candidate))) return candidate;
  }

  return `${base}-${Math.random().toString(36).slice(2, 8)}`;
};

export default slugify;
