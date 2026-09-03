'use strict';

import crypto from 'node:crypto';

const POLICY = 'deterministic-lexical-v1';
const CONTRACT_SCHEMA_VERSION = '1.0';
const ASSESSMENT_SCHEMA_VERSION = '1.0';
const MAX_QUERY_CHARS = 8 * 1024;
const MAX_FIELD_CHARS = 8 * 1024;
const MAX_EVIDENCE_CHARS = 24 * 1024;
const MAX_VISIBLE_BODY_CHARS = 512 * 1024;
const MAX_ANCHORS = 32;
const MIN_ANCHOR_CODEPOINTS = 2;
const MAX_ANCHOR_CODEPOINTS = 64;

const GENERIC_TASKS = new Set([
  '文章', '一篇文章', '公开资料', '资料', 'article', 'an article', 'articles', 'public information',
]);
const ORCHESTRATION = [
  /(?:请|帮我|帮忙|需要|我要|我想)?(?:采集|收集|抓取|获取|保存|下载|整理)/giu,
  /(?:一|两|三|四|五|六|七|八|九|十|\d+)\s*(?:篇|个|条|份)/giu,
  /(?:最终|完成后|采集完成|并把|并将|然后|文件|正文|本地图片|图片文件夹|当前会话(?:下空间)?|根目录)/giu,
  /(?:并)?(?:落盘|完整全文|完整正文|全文|原文)/giu,
  /(?:这|该|指定|上述)?(?:一)?篇?(?:头条)?文章/giu,
  /\b(?:collect|fetch|download|save|gather|find|please|final|file|files|markdown|local|images?)\b/giu,
];

function boundedText(value, max = MAX_FIELD_CHARS) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function normalizeText(value) {
  return boundedText(value, MAX_VISIBLE_BODY_CHARS)
    .normalize('NFKC')
    .toLocaleLowerCase('und')
    .replace(/[‐‑‒–—―]/gu, '-')
    .replace(/\s+/gu, ' ')
    .trim();
}

function stripLocations(value) {
  return boundedText(value, MAX_QUERY_CHARS)
    .replace(/`[^`]*`/gu, ' ')
    .replace(/https?:\/\/[^\s，。；、)）]+/giu, ' ')
    .replace(/(?:^|\s)(?:\.{0,2}\/|\/)[^\s，。；、)）]+/gu, ' ');
}

function extractSubject(rawQuery) {
  const query = stripLocations(rawQuery).normalize('NFKC').trim();
  if (/^(?:请|帮我|帮忙|需要|我要|我想)?\s*(?:采集|收集|抓取|获取|找)\s*(?:一|两|三|四|五|六|七|八|九|十|\d+)?\s*(?:篇|个|条|份)?\s*(?:文章|报道|论文|资料|内容)(?:[，。；、]|\s|并|且|$)/iu.test(query)) {
    return { subject: '文章', explicit: false };
  }
  const patterns = [
    /关于\s*(.+?)\s*(?:的\s*)?(?:文章|报道|论文|资料|内容)(?=[,，.。;；、]|并|且|$)/iu,
    /(?:采集|收集|抓取|获取|找)\s*(?:一|两|三|四|五|六|七|八|九|十|\d+)?\s*(?:篇|个|条|份)?\s*(.+?)\s*(?:的\s*)?(?:文章|报道|论文|资料|内容)(?=[,，.。;；、]|并|且|$)/iu,
    /\b(?:about|on)\s+(.+?)(?:\s+(?:article|report|paper|content))?(?:[,. ;]|$)/iu,
  ];
  for (const pattern of patterns) {
    const match = query.match(pattern);
    if (match?.[1]?.trim()) return { subject: match[1].trim(), explicit: true };
  }
  let subject = query;
  for (const pattern of ORCHESTRATION) subject = subject.replace(pattern, ' ');
  subject = subject
    .replace(/(?:并|且|到|至|下|中|里|内)+/gu, ' ')
    .replace(/[，。；、,:;!?！？()（）[\]{}]/gu, ' ')
    .replace(/\s+/gu, ' ')
    .trim();
  return { subject, explicit: false };
}

function isMultiTopic(rawQuery, subject) {
  const text = normalizeText(`${rawQuery}\n${subject}`);
  return /(?:各\s*(?:一|两|三|四|五|六|七|八|九|十|\d+)\s*(?:篇|个|条|份)|\b(?:each|respectively)\b)/iu.test(text)
    || /\S+\s*(?:和|与|以及)\s*\S+/u.test(subject)
    || /\S+\s+and\s+\S+/iu.test(subject);
}

function validAnchor(value) {
  const length = [...value].length;
  return length >= MIN_ANCHOR_CODEPOINTS && length <= MAX_ANCHOR_CODEPOINTS
    && /[\p{L}\p{N}]/u.test(value);
}

function uniqueAnchors(values) {
  return [...new Set(values.map(normalizeText).filter(validAnchor))].slice(0, MAX_ANCHORS);
}

function topicAnchors(subject, explicit) {
  const normalized = normalizeText(subject);
  if (!normalized) return { strongAnchors: [], supportingAnchors: [] };
  if (explicit || !normalized.includes(' ')) {
    return { strongAnchors: uniqueAnchors([normalized]), supportingAnchors: [] };
  }
  const rawTokens = subject.split(/\s+/u).filter(Boolean);
  const strong = [];
  const supporting = [];
  for (const rawToken of rawTokens) {
    const token = normalizeText(rawToken);
    if (!validAnchor(token)) continue;
    if (/\d/u.test(rawToken) || /[-_.+]/u.test(rawToken) || /[a-z][A-Z]/u.test(rawToken)) strong.push(token);
    else supporting.push(token);
  }
  if (!strong.length && supporting.length === 1) strong.push(supporting.shift());
  return {
    strongAnchors: uniqueAnchors(strong),
    supportingAnchors: uniqueAnchors(supporting).slice(0, MAX_ANCHORS - strong.length),
  };
}

export function createTopicContract(rawQuery, { required = true } = {}) {
  const { subject, explicit } = extractSubject(rawQuery);
  const normalizedSubject = normalizeText(subject);
  if (!required) {
    return {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      policy: POLICY,
      required: false,
      normalizedSubject,
      strongAnchors: [],
      supportingAnchors: [],
      source: 'task-query',
      notAppliedReason: 'scope-exempt',
    };
  }
  if (isMultiTopic(rawQuery, subject)) {
    return {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      policy: POLICY,
      required: false,
      normalizedSubject,
      strongAnchors: [],
      supportingAnchors: [],
      source: 'task-query',
      notAppliedReason: 'unsupported-multi-topic',
    };
  }
  const anchors = topicAnchors(subject, explicit);
  if (!normalizedSubject || GENERIC_TASKS.has(normalizedSubject)
    || (!anchors.strongAnchors.length && !anchors.supportingAnchors.length)) {
    return {
      schemaVersion: CONTRACT_SCHEMA_VERSION,
      policy: POLICY,
      required: false,
      normalizedSubject,
      ...anchors,
      source: 'task-query',
      notAppliedReason: 'no-specific-topic',
    };
  }
  return {
    schemaVersion: CONTRACT_SCHEMA_VERSION,
    policy: POLICY,
    required: true,
    normalizedSubject,
    ...anchors,
    source: 'task-query',
  };
}

function latinAnchor(anchor) {
  return /^[\p{Script=Latin}\p{N}\s\-_.+]+$/u.test(anchor);
}

function normalizeLexicalBoundaries(value) {
  return value
    .replace(/(\p{Script=Han})([\p{Script=Latin}\p{N}])/gu, '$1 $2')
    .replace(/([\p{Script=Latin}\p{N}])(\p{Script=Han})/gu, '$1 $2')
    .replace(/(\p{Script=Latin})(\p{N})/gu, '$1 $2')
    .replace(/(\p{N})(\p{Script=Latin})/gu, '$1 $2');
}

function anchorPattern(anchor) {
  const escaped = anchor.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/[\s\-_.+]+/gu, '[\\s\\-_.+]+');
  return new RegExp(`(^|[^\\p{L}\\p{N}])${escaped}(?=$|[^\\p{L}\\p{N}])`, 'iu');
}

function matchesAnchor(normalized, anchor) {
  return latinAnchor(anchor)
    ? anchorPattern(normalizeLexicalBoundaries(anchor)).test(normalizeLexicalBoundaries(normalized))
    : normalized.includes(anchor);
}

function matchedAnchors(contract, normalized) {
  return {
    strong: contract.strongAnchors.filter((anchor) => matchesAnchor(normalized, anchor)),
    supporting: contract.supportingAnchors.filter((anchor) => matchesAnchor(normalized, anchor)),
  };
}

function assessment(status, matched = {}, evidenceFields = [], extra = {}) {
  return {
    schemaVersion: ASSESSMENT_SCHEMA_VERSION,
    status,
    policy: POLICY,
    matchedStrongAnchors: matched.strong || [],
    matchedSupportingAnchors: matched.supporting || [],
    evidenceFields,
    ...extra,
  };
}

function evidenceDigest(value) {
  return crypto.createHash('sha256').update(value).digest('hex');
}

function candidateEvidence(candidate) {
  const fields = [];
  let total = 0;
  for (const [name, rawValue] of [
    ['title', candidate?.title],
    ['content', candidate?.content],
    ['searxngContent', candidate?.searxngContent],
    ['titleContext', candidate?.titleContext],
  ]) {
    if (total >= MAX_EVIDENCE_CHARS) break;
    const value = boundedText(rawValue, Math.min(MAX_FIELD_CHARS, MAX_EVIDENCE_CHARS - total));
    if (!value.trim()) continue;
    total += value.length;
    fields.push([name, normalizeText(value)]);
  }
  try {
    const url = new URL(candidate?.url);
    const slug = decodeURIComponent(url.pathname).replace(/[\/_-]+/gu, ' ').trim();
    if (slug && total < MAX_EVIDENCE_CHARS) fields.push(['urlPath', normalizeText(slug)]);
  } catch {
    // Page-shape validation owns invalid URL diagnostics.
  }
  return fields;
}

export function assessCandidateTopic(contract, candidate) {
  if (!contract?.required) return assessment('not-required');
  const fields = candidateEvidence(candidate);
  if (!fields.length) return assessment('unknown', {}, [], { reason: 'no-evaluable-text' });
  const inputDigest = evidenceDigest(fields.map(([field, value]) => `${field}\n${value}`).join('\n\n'));
  const strong = new Set();
  const supporting = new Set();
  const evidenceFields = new Set();
  for (const [field, value] of fields) {
    const matched = matchedAnchors(contract, value);
    matched.strong.forEach((anchor) => strong.add(anchor));
    matched.supporting.forEach((anchor) => supporting.add(anchor));
    if (matched.strong.length || matched.supporting.length) evidenceFields.add(field);
  }
  const matched = { strong: [...strong], supporting: [...supporting] };
  const status = strong.size > 0 || supporting.size >= 2 ? 'matched' : 'unmatched';
  return assessment(status, matched, [...evidenceFields], { inputDigest });
}

export function assertDiscoveryQueryMatches(contract, query) {
  if (!contract?.required) return;
  const normalized = normalizeText(stripLocations(query));
  const matched = matchedAnchors(contract, normalized);
  if (!matched.strong.length && matched.supporting.length < 2) {
    throw new Error('DISCOVERY_QUERY_DRIFT: 检索词必须保留初始化任务的主题锚点');
  }
}

function visibleMarkdownBlocks(markdown) {
  const input = boundedText(markdown, MAX_VISIBLE_BODY_CHARS);
  const lines = input.split(/\r?\n/u);
  let inFrontmatter = lines[0]?.trim() === '---';
  const visible = [];
  for (const [index, line] of lines.entries()) {
    const trimmed = line.trim();
    if (inFrontmatter) {
      if (index > 0 && trimmed === '---') inFrontmatter = false;
      continue;
    }
    const cleaned = line
      .replace(/!\[[^\]]*\]\([^)]*\)/gu, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/gu, '$1')
      .replace(/https?:\/\/\S+/giu, ' ')
      .trim();
    if (/^[\w.-]+\s*:\s*\S+/u.test(cleaned)) continue;
    visible.push(cleaned);
  }
  return visible.join('\n').split(/\n\s*\n+/u).map(normalizeText).filter(Boolean);
}

export function assessMaterializedTopic(contract, { title = '', markdown = '' } = {}) {
  if (!contract?.required) return assessment('not-required');
  const bodyTruncated = typeof markdown === 'string' && markdown.length > MAX_VISIBLE_BODY_CHARS;
  const normalizedTitle = normalizeText(title);
  const blocks = visibleMarkdownBlocks(markdown);
  const inputDigest = evidenceDigest(`${normalizedTitle}\n\n${blocks.join('\n\n')}`);
  const titleMatched = matchedAnchors(contract, normalizedTitle);
  if (titleMatched.strong.length || titleMatched.supporting.length >= 2) {
    return assessment('matched', titleMatched, ['title'], { inputDigest });
  }
  if (!normalizedTitle && !blocks.length) {
    return assessment('unknown', {}, [], { reason: 'no-evaluable-text', inputDigest });
  }
  const strongBlocks = new Map();
  const supportingBlocks = new Map();
  blocks.forEach((block, index) => {
    const matched = matchedAnchors(contract, block);
    matched.strong.forEach((anchor) => {
      if (!strongBlocks.has(anchor)) strongBlocks.set(anchor, new Set());
      strongBlocks.get(anchor).add(index);
    });
    matched.supporting.forEach((anchor) => {
      if (!supportingBlocks.has(anchor)) supportingBlocks.set(anchor, new Set());
      supportingBlocks.get(anchor).add(index);
    });
  });
  const repeatedStrong = [...strongBlocks].filter(([, indexes]) => indexes.size >= 2).map(([anchor]) => anchor);
  const supporting = [...supportingBlocks.keys()];
  const supportingBlockCount = new Set([...supportingBlocks.values()].flatMap((indexes) => [...indexes])).size;
  const matched = {
    strong: [...new Set([...titleMatched.strong, ...repeatedStrong])],
    supporting: [...new Set([...titleMatched.supporting, ...supporting])],
  };
  const status = repeatedStrong.length > 0 || (matched.supporting.length >= 2 && supportingBlockCount >= 2)
    ? 'matched' : 'unmatched';
  if (status === 'unmatched' && bodyTruncated) {
    return assessment('unknown', matched, [], { inputDigest, reason: 'visible-text-limit-exceeded' });
  }
  return assessment(status, matched, status === 'matched' ? ['body'] : [], { inputDigest });
}

export function isEligibleArticle(candidate) {
  return candidate?.pageType === 'article'
    && ['matched', 'not-required'].includes(candidate?.topicRelevance?.status);
}
