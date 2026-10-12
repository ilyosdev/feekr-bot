/**
 * What a customer typed instead of pressing a button. Pure, so it can be tested without Telegram.
 *
 * The questions end with "(Ha / Yo'q)" and "(1 dan 10 gacha)", so people type the answer. Uzbek is
 * written in Latin and in Cyrillic, with several apostrophes, and some answer in Russian.
 */

const YES = new Set(['ha', 'xa', 'ҳа', 'ха', 'да', 'yes']);
// Compared without apostrophes: yo'q, yoʻq, yo‘q, yo`q and yoq are the same answer.
const NO = new Set(['yoq', 'yuq', 'йўқ', 'йуқ', 'йук', 'йоқ', 'йок', 'нет', 'no']);

const APOSTROPHES = /['ʻʼ‘’`´′]/g;
/** Lowercase, without whatever surrounds the word: spaces, punctuation, the ✅ of a copied button. */
const core = (text: string) => text.toLowerCase().replace(/^[^\p{L}\p{N}]+|[^\p{L}\p{N}]+$/gu, '');

/** true for "Ha", false for "Yo'q", null when it is neither. */
export function parseYesNo(text: string): boolean | null {
  const word = core(text).replace(APOSTROPHES, '');
  if (YES.has(word)) return true;
  if (NO.has(word)) return false;
  return null;
}

/** The whole number from 1 to 10 that was typed, or null. */
export function parseRating(text: string): number | null {
  const match = /^\s*(\d{1,2})\s*[.!]*\s*$/.exec(text);
  if (!match) return null;
  const rating = Number(match[1]);
  return rating >= 1 && rating <= 10 ? rating : null;
}
