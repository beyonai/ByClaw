'use strict';

import crypto from 'node:crypto';

const CHALLENGE = /(?:验证码|人机验证|captcha|verify you are human|access denied)/i;
const TRUNCATION = /(?:输出已截断|内容已截断|\btruncated\b|\btruncation\b)/i;
const KNOWN_UI = /^(?:赞赏|调整字号|暂无留言|写留言|相关阅读|扫码关注|scan to follow|在小说阅读器中阅读|继续滑动看下一个)$/i;
const PURE_IMAGE = /^!\[[^\]]*\]\([^)]*\)$/;
const REMOTE_IMAGE = /!\[[^\]]*\]\(https?:\/\/[^)]+\)/gi;
const MAX_PARAGRAPHS = 5_000;
const MIN_SUBSTANTIVE_CHARS = 8;

export function normalizeAuditParagraph(value) {
  return String(value || '')
    .normalize('NFKC')
    .replace(/[，]/g, ',')
    .replace(/[。]/g, '.')
    .replace(/[！]/g, '!')
    .replace(/[？]/g, '?')
    .replace(/[：]/g, ':')
    .replace(/[；]/g, ';')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function withoutFrontmatter(markdown) {
  const source = String(markdown || '').replace(/^\uFEFF/, '');
  return /^---\s*\n/.test(source) ? source.replace(/^---\s*\n[\s\S]*?\n---\s*(?:\n|$)/, '') : source;
}

function paragraphs(markdown) {
  let allowedDeletionCount = 0;
  const rows = withoutFrontmatter(markdown).split(/\n\s*\n+/);
  const substantive = [];
  for (const raw of rows) {
    const trimmed = raw.trim();
    if (!trimmed) continue;
    if (PURE_IMAGE.test(trimmed) || KNOWN_UI.test(normalizeAuditParagraph(trimmed))) {
      allowedDeletionCount += 1;
      continue;
    }
    const remoteImages = trimmed.match(REMOTE_IMAGE)?.length || 0;
    const cleaned = normalizeAuditParagraph(trimmed.replace(REMOTE_IMAGE, ''));
    allowedDeletionCount += remoteImages;
    if (cleaned.replace(/[^\p{L}\p{N}]/gu, '').length < MIN_SUBSTANTIVE_CHARS) continue;
    substantive.push(cleaned);
  }
  return { substantive, allowedDeletionCount };
}

function digest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function lcsMatches(raw, final) {
  const left = raw.map(digest);
  const right = final.map(digest);
  const table = Array.from({ length: left.length + 1 }, () => new Uint16Array(right.length + 1));
  for (let i = 1; i <= left.length; i += 1) {
    for (let j = 1; j <= right.length; j += 1) {
      table[i][j] = left[i - 1] === right[j - 1]
        ? table[i - 1][j - 1] + 1
        : Math.max(table[i - 1][j], table[i][j - 1]);
    }
  }
  const matchedRaw = new Set();
  const matchedFinal = new Set();
  let i = left.length;
  let j = right.length;
  while (i > 0 && j > 0) {
    if (left[i - 1] === right[j - 1]) {
      matchedRaw.add(i - 1);
      matchedFinal.add(j - 1);
      i -= 1;
      j -= 1;
    } else if (table[i - 1][j] >= table[i][j - 1]) i -= 1;
    else j -= 1;
  }
  return { matchedRaw, matchedFinal };
}

function ratio(numerator, denominator) {
  return denominator ? Number((numerator / denominator).toFixed(6)) : 0;
}

function unknown(reason, extra = {}) {
  return { schemaVersion: '1.0', status: 'audit-unknown', reason, ...extra };
}

export function auditBaselineContent({ rawMarkdown, finalMarkdown }) {
  const rawSource = String(rawMarkdown || '');
  const finalSource = String(finalMarkdown || '');
  if (CHALLENGE.test(`${rawSource}\n${finalSource}`)) return unknown('challenge-detected');
  if (TRUNCATION.test(`${rawSource}\n${finalSource}`)) return unknown('truncation-detected');
  try {
    const raw = paragraphs(rawSource);
    const final = paragraphs(finalSource);
    if (raw.substantive.length < 3 || final.substantive.length < 3) {
      return unknown('insufficient-substantive-content', {
        rawSubstantiveCount: raw.substantive.length,
        finalSubstantiveCount: final.substantive.length,
      });
    }
    if (raw.substantive.length > MAX_PARAGRAPHS || final.substantive.length > MAX_PARAGRAPHS) {
      return unknown('paragraph-limit-exceeded');
    }
    const matches = lcsMatches(raw.substantive, final.substantive);
    const matchedCount = matches.matchedRaw.size;
    const coverageRatio = ratio(matchedCount, raw.substantive.length);
    const fidelityRatio = ratio(matchedCount, final.substantive.length);
    const report = {
      schemaVersion: '1.0',
      status: coverageRatio >= 0.9 && fidelityRatio >= 0.95 ? 'passed' : 'audit-unknown',
      reason: coverageRatio >= 0.9 && fidelityRatio >= 0.95 ? null : 'content-ratio-below-threshold',
      rawSubstantiveCount: raw.substantive.length,
      finalSubstantiveCount: final.substantive.length,
      matchedCount,
      coverageRatio,
      fidelityRatio,
      allowedDeletionCount: raw.allowedDeletionCount + final.allowedDeletionCount,
      missingParagraphs: raw.substantive
        .filter((_, index) => !matches.matchedRaw.has(index)).slice(0, 10),
      extraParagraphs: final.substantive
        .filter((_, index) => !matches.matchedFinal.has(index)).slice(0, 10),
    };
    return report;
  } catch (error) {
    return unknown('parse-error', {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
