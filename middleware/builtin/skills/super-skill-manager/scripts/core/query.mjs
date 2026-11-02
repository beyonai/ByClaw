const BUILTIN_ALIASES = Object.freeze({
  '代码审查': Object.freeze(['code review', 'PR review']),
  'code review': Object.freeze(['代码审查', 'PR review']),
  'pr review': Object.freeze(['代码审查', 'code review']),
  '技能': Object.freeze(['skill']),
  'skill': Object.freeze(['技能']),
  '安全审计': Object.freeze(['security audit']),
  'security audit': Object.freeze(['安全审计']),
});

export function normalizeQuery(query) {
  if (typeof query !== 'string') throw new TypeError('query must be a string');
  const normalized = query.trim().replace(/\s+/gu, ' ');
  if (!normalized) throw new TypeError('query must not be empty');
  return normalized;
}

function aliasValues(aliases, query) {
  if (aliases === undefined) return [];
  if (aliases === null || typeof aliases !== 'object' || Array.isArray(aliases)) {
    throw new TypeError('aliases must be an object');
  }
  const match = Object.keys(aliases).find((key) => normalizeQuery(key).toLocaleLowerCase() === query.toLocaleLowerCase());
  if (match === undefined) return [];
  return Array.isArray(aliases[match]) ? aliases[match] : [];
}

export function expandQuery(query, { aliases } = {}) {
  const original = normalizeQuery(query);
  const lookup = original.toLocaleLowerCase();
  const candidates = [original, ...aliasValues(aliases, original), ...(BUILTIN_ALIASES[lookup] ?? [])];
  const result = [];
  const seen = new Set();
  for (const candidate of candidates) {
    if (typeof candidate !== 'string') continue;
    const normalized = candidate.trim().replace(/\s+/gu, ' ');
    if (!normalized) continue;
    const key = normalized.toLocaleLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(normalized);
    if (result.length === 3) break;
  }
  return result;
}
