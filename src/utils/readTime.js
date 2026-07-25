import { WORDS_PER_MINUTE } from '../constants/index.js';

/** Strips HTML tags and collapses entities so word counts reflect prose only. */
export const htmlToText = (html) =>
  String(html ?? '')
    .replace(/<(script|style)[^>]*>[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/\s+/g, ' ')
    .trim();

/** Word count of an HTML document. */
export const countWords = (html) => {
  const text = htmlToText(html);
  return text ? text.split(' ').filter(Boolean).length : 0;
};

/**
 * Reading time in whole minutes, floored at 1 for any non-empty document.
 * Matches the frontend's `estimateReadingTime` in utils/articlesStore.js.
 */
export const calculateReadTime = (html) => {
  const words = countWords(html);
  if (words === 0) return 0;
  return Math.max(1, Math.round(words / WORDS_PER_MINUTE));
};

/** Renders minutes as the `"5 min read"` label the article cards expect. */
export const formatReadingTime = (minutes) => `${Math.max(1, Number(minutes) || 1)} min read`;

/**
 * Readability proxy used by the Write page's "reading ease" gauge:
 * shorter average sentences score higher. Mirrors pages/Write.jsx.
 */
export const readingEase = (html) => {
  const text = htmlToText(html);
  const words = text ? text.split(' ').filter(Boolean) : [];
  if (words.length === 0) return 0;

  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const averageWordsPerSentence = words.length / sentences;

  return Math.max(20, Math.min(98, Math.round(120 - averageWordsPerSentence * 4)));
};

/**
 * First meaningful sentence(s) of a document, used as the card description
 * when the author did not supply an excerpt.
 */
export const buildExcerpt = (html, maxLength = 160) => {
  const text = htmlToText(html);
  if (!text) return '';
  if (text.length <= maxLength) return text;

  const clipped = text.slice(0, maxLength);
  const lastSpace = clipped.lastIndexOf(' ');
  return `${(lastSpace > 40 ? clipped.slice(0, lastSpace) : clipped).trimEnd()}…`;
};

export default calculateReadTime;
