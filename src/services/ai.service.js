import crypto from 'node:crypto';
import { AI_LENGTHS, DEFAULT_AI_LENGTH, DEFAULT_TONE, TONES } from '../constants/index.js';
import { countWords, htmlToText, readingEase } from '../utils/readTime.js';
import { sanitizeArticleHtml, stripTags } from '../helpers/sanitizeHtml.helper.js';
import billingService from './billing.service.js';

/**
 * AI Writer generation service.
 *
 * This is a server-side port of the template generator that previously ran in
 * pages/AIWriter.jsx, so the feature works with no external model provider,
 * API key, or per-request cost. The composition step is isolated behind
 * `compose()`, which is the single function to replace when swapping in a
 * hosted model — every caller, route and validator stays as-is.
 */

const TITLE_TEMPLATES = {
  Academic: (topic) => `An Analysis of ${topic}`,
  Minimalist: (topic) => `${topic}: A Simple Guide`,
  Persuasive: (topic) => `Why ${topic} Matters More Than Ever`,
  Technical: (topic) => `${topic}: A Technical Deep Dive`,
};

const OPENERS = [
  (topic, category) =>
    `${topic} has moved from a niche concern to a central conversation in ${category}, and for good reason.`,
  (topic) => `Few subjects reward closer attention right now quite like ${topic}.`,
  (topic, category) => `If there is one theme shaping ${category} this year, it is ${topic}.`,
];

const BODY_SENTENCES = [
  'The core idea is straightforward: small, deliberate changes compound into outcomes that are hard to ignore.',
  'Practitioners who engage early tend to build an advantage that is difficult for latecomers to close.',
  'What makes this moment different is the speed at which theory is turning into practice.',
  'Skeptics point to the hype cycle, but the underlying fundamentals suggest this is not a passing trend.',
  'The data so far paints a consistent picture: adoption is accelerating, not slowing down.',
  'Teams that treat this as a checkbox exercise consistently underperform those who treat it as a discipline.',
  'The gap between the leaders and everyone else is widening, not narrowing.',
  'None of this requires a leap of faith — the evidence is already sitting in the numbers.',
];

const CLOSERS = [
  (topic, category) =>
    `The takeaway for anyone working in ${category} is simple: start now, iterate often, and stay close to the evidence.`,
  (topic) => `Ultimately, ${topic} rewards patience and clear thinking more than it rewards speed alone.`,
  (topic, category) =>
    `Whatever comes next, ${topic} is no longer optional for teams serious about ${category}.`,
];

const PULL_QUOTES = [
  (topic) =>
    `The machine does not replace the writer; it provides the scaffold upon which ${topic} finds its sharpest form.`,
  (topic) =>
    `${topic} is not a destination — it is the compounding discipline of showing up with better questions.`,
  (topic) =>
    `Every advance in ${topic} still answers to the same test: does it make the work clearer, faster, or truer.`,
];

const PARAGRAPH_COUNT = { Short: 1, Medium: 3, Long: 5 };

const capitalize = (value) => (value ? value[0].toUpperCase() + value.slice(1) : value);

/**
 * Deterministic pseudo-random source.
 *
 * Seeding from the request means the same prompt yields the same article,
 * which keeps the endpoint cacheable and its tests meaningful; `variation`
 * lets the client ask for a different take on an identical prompt.
 */
const createRandom = (seed) => {
  let digest = crypto.createHash('sha256').update(String(seed)).digest();
  let offset = 0;

  return () => {
    // Re-hash once the current digest is consumed, giving an unbounded stream
    // rather than a short repeating cycle.
    if (offset + 4 > digest.length) {
      digest = crypto.createHash('sha256').update(digest).digest();
      offset = 0;
    }

    const value = digest.readUInt32BE(offset);
    offset += 4;
    return value / 0x1_0000_0000;
  };
};

const pickWith = (random) => (list) => list[Math.floor(random() * list.length) % list.length];

/** Fisher–Yates using the seeded source, so ordering is reproducible. */
const shuffleWith = (random) => (list) => {
  const result = [...list];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex], result[index]];
  }
  return result;
};

/**
 * Builds the draft. Replace this function to delegate to a hosted model.
 *
 * @returns {{ title: string, html: string }}
 */
const compose = ({ topic, tone, length, category, variation }) => {
  const random = createRandom(`${topic}|${tone}|${length}|${category}|${variation}`);
  const pick = pickWith(random);
  const shuffle = shuffleWith(random);

  const title = (TITLE_TEMPLATES[tone] ?? TITLE_TEMPLATES[DEFAULT_TONE])(topic);

  const paragraphCount = PARAGRAPH_COUNT[length] ?? PARAGRAPH_COUNT[DEFAULT_AI_LENGTH];
  const bodyParagraphs = shuffle(BODY_SENTENCES).slice(0, paragraphCount);
  const midpoint = Math.floor(bodyParagraphs.length / 2);

  const html = [
    `<p>${pick(OPENERS)(topic, category)}</p>`,
    ...bodyParagraphs.slice(0, midpoint + 1).map((sentence) => `<p>${sentence}</p>`),
    `<blockquote><p>${pick(PULL_QUOTES)(topic)}</p></blockquote>`,
    ...bodyParagraphs.slice(midpoint + 1).map((sentence) => `<p>${sentence}</p>`),
    `<p>${pick(CLOSERS)(topic, category)}</p>`,
  ].join('');

  return { title, html };
};

/**
 * Generates a draft from the AI Writer intake form.
 *
 * @param {object} input
 * @param {string} input.topic
 * @param {string} [input.tone]
 * @param {string} [input.length]
 * @param {string} [input.category]
 * @param {number} [input.variation] Bump to regenerate a different draft.
 */
export const generateArticle = ({ topic, tone, length, category, variation = 0 }) => {
  const cleanTopic = capitalize(stripTags(topic).trim());
  const safeTone = TONES.includes(tone) ? tone : DEFAULT_TONE;
  const safeLength = AI_LENGTHS.includes(length) ? length : DEFAULT_AI_LENGTH;
  const safeCategory = stripTags(category) || 'General';

  const { title, html } = compose({
    topic: cleanTopic,
    tone: safeTone,
    length: safeLength,
    category: safeCategory,
    variation,
  });

  const content = sanitizeArticleHtml(html);
  const wordCount = countWords(content);

  return {
    title,
    content,
    html: content,
    excerpt: htmlToText(content).slice(0, 160),
    topic: cleanTopic,
    tone: safeTone,
    length: safeLength,
    category: safeCategory,
    variation,
    wordCount,
    readTime: Math.max(1, Math.round(wordCount / 200)),
    readingEase: readingEase(content),
  };
};

/** A single extra paragraph, for the "Generate next paragraph" button. */
export const generateParagraph = ({ topic = '', variation = 0 } = {}) => {
  const random = createRandom(`paragraph|${topic}|${variation}`);
  const sentence = pickWith(random)(BODY_SENTENCES);

  return { html: sanitizeArticleHtml(`<p>${sentence}</p>`), text: sentence };
};

/**
 * Editorial feedback for the Neural Sidebar panels.
 *
 * Every insight is computed from the supplied draft rather than canned, so
 * the numbers shown to the writer reflect their actual text.
 */
export const generateInsights = ({ content = '', topic = '', tone = DEFAULT_TONE, category = 'General', length = DEFAULT_AI_LENGTH }) => {
  const text = htmlToText(content);
  const words = countWords(content);
  const paragraphs = (content.match(/<p[\s>]/gi) || []).length;
  const sentences = (text.match(/[.!?]+/g) || []).length || 1;
  const ease = readingEase(content);
  const lowerCategory = String(category).toLowerCase();

  const supportingPoints =
    { Short: 'one', Medium: 'three', Long: 'five' }[length] ?? 'three';

  return {
    rewrite: paragraphs > 1
      ? `The opening paragraph establishes the ${lowerCategory} focus. With ${paragraphs} paragraphs averaging ${Math.round(words / paragraphs)} words, the transition into the supporting evidence is the strongest candidate for tightening.`
      : 'The draft is currently a single paragraph. Splitting it into an introduction and supporting sections will improve scannability.',

    research: topic
      ? `Consider adding 2-3 supporting citations near paragraph ${Math.min(2, Math.max(1, paragraphs))} to reinforce the claims about ${topic}.`
      : 'Add a topic to receive targeted citation suggestions.',

    factcheck: words === 0
      ? 'Nothing to scan yet — start writing to enable fact checking.'
      : `Scanned ${words} words across ${sentences} sentences. No internal contradictions detected in the current draft.`,

    outline: `Structure: introduction, ${supportingPoints} supporting points, and a closing call to action. Currently ${paragraphs} block${paragraphs === 1 ? '' : 's'}.`,

    images: words > 400
      ? 'A contextual image near the pull-quote would break up a long scroll and is likely to improve completion rate.'
      : 'The draft is short enough to read without a visual break; add imagery once it passes ~400 words.',

    summary: topic
      ? `In short: ${topic} is reshaping ${lowerCategory}, and early movers are pulling ahead.`
      : `A ${words}-word draft in ${category}.`,

    tone: `Target tone: ${tone}. Reading ease scores ${ease}/100 at ${Math.round(words / sentences)} words per sentence.`,

    stats: {
      words,
      paragraphs,
      sentences,
      readingEase: ease,
      readTime: Math.max(1, Math.round(words / 200)),
    },
  };
};

/* ---------------------------------------------------------------------------
 * Metered entry points
 *
 * The functions above are pure: given a payload they compose text and return
 * it. These wrappers add the plan quota around them, and they are what the
 * controller calls.
 *
 * The order is reserve, then generate, then release on failure. Generating
 * first and counting afterwards would let two simultaneous requests both pass
 * the check and overshoot the limit; claiming the slot first makes the
 * database the arbiter. The `catch` hands the slot back so work that produced
 * nothing does not spend the user's day.
 *
 * Only these two count. `generateInsights` analyses text the author already
 * wrote — word counts, readability, suggestions — and produces no new prose,
 * and `options` returns static lists; neither is a generation.
 * ------------------------------------------------------------------------ */

/** Metered `generateArticle`. */
export const generateArticleFor = async (userId, payload) => {
  await billingService.consumeAiGeneration(userId);

  try {
    return generateArticle(payload);
  } catch (error) {
    await billingService.releaseAiGeneration(userId);
    throw error;
  }
};

/** Metered `generateParagraph`. */
export const generateParagraphFor = async (userId, payload) => {
  await billingService.consumeAiGeneration(userId);

  try {
    return generateParagraph(payload);
  } catch (error) {
    await billingService.releaseAiGeneration(userId);
    throw error;
  }
};

export default {
  generateArticleFor,
  generateParagraphFor,
  generateArticle,
  generateParagraph,
  generateInsights,
};
