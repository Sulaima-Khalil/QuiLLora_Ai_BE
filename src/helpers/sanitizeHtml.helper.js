import sanitizeHtmlLib from 'sanitize-html';

/**
 * Allow-list matching what the TipTap editor can actually produce
 * (StarterKit + Link, Image, Underline, TextAlign, TextStyle/FontSize).
 *
 * Anything outside this list is dropped, so stored article HTML can be
 * rendered with `dangerouslySetInnerHTML` without an XSS vector.
 */
const ARTICLE_OPTIONS = {
  allowedTags: [
    'p', 'br', 'hr',
    'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
    'strong', 'b', 'em', 'i', 'u', 's', 'strike', 'del', 'mark', 'sub', 'sup',
    'ul', 'ol', 'li',
    'blockquote', 'pre', 'code',
    'a', 'img', 'figure', 'figcaption',
    'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
    'span', 'div',
  ],
  allowedAttributes: {
    a: ['href', 'title', 'target', 'rel'],
    img: ['src', 'alt', 'title', 'width', 'height'],
    th: ['colspan', 'rowspan', 'scope'],
    td: ['colspan', 'rowspan'],
    // TipTap writes alignment and font size as inline styles.
    '*': ['style', 'class'],
  },
  allowedStyles: {
    '*': {
      'text-align': [/^(left|right|center|justify)$/],
      'font-size': [/^\d{1,3}(\.\d+)?(px|pt|em|rem|%)$/],
      color: [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
      'background-color': [/^#[0-9a-f]{3,8}$/i, /^rgba?\([\d\s.,%]+\)$/i],
    },
  },
  // `javascript:` and `vbscript:` are absent by design.
  allowedSchemes: ['http', 'https', 'mailto'],
  allowedSchemesByTag: { img: ['http', 'https', 'data'] },
  allowProtocolRelative: false,
  transformTags: {
    // Prevent reverse-tabnabbing on author-supplied outbound links.
    a: sanitizeHtmlLib.simpleTransform('a', { rel: 'noopener noreferrer nofollow' }, true),
  },
};

/** Sanitises rich-text article bodies, preserving safe formatting. */
export const sanitizeArticleHtml = (html) => {
  if (!html) return '';
  return sanitizeHtmlLib(String(html), ARTICLE_OPTIONS);
};

/**
 * Reverses the entity encoding sanitize-html applies while stripping tags.
 *
 * Without this, a name like "Web Developer & Data Analyst" would be stored as
 * "&amp;" and rendered literally by React, which escapes text nodes itself.
 */
const decodeEntities = (value) =>
  value
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#x27;|&#39;/gi, "'")
    .replace(/&#x2F;|&#47;/gi, '/')
    // `&amp;` must be decoded last, or "&amp;lt;" would become "<".
    .replace(/&amp;/gi, '&');

/**
 * Strips every tag — for fields rendered as plain text (names, titles,
 * excerpts, tags, collection names).
 *
 * Returns genuine plain text: tags are removed, entities decoded, and any
 * residual angle brackets dropped so no markup can be reconstructed from the
 * stored value even if it is later interpolated into HTML.
 */
export const stripTags = (value) => {
  if (value === null || value === undefined) return value;

  const withoutTags = sanitizeHtmlLib(String(value), { allowedTags: [], allowedAttributes: {} });

  return decodeEntities(withoutTags).replace(/[<>]/g, '').trim();
};

export default { sanitizeArticleHtml, stripTags };
