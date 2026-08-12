import { errorEnvelope, successEnvelope } from '../core/envelope.mjs';

const PUBLIC_SESSION_KEYS = new Set(['provider', 'sessionId', 'status', 'loginUrl', 'domain', 'observedAt']);
function safeUrl(value) { try { const url = new URL(value); url.username = ''; url.password = ''; url.search = ''; url.hash = ''; return url.toString(); } catch { return null; } }
export function redactText(value) {
  return String(value ?? '')
    .replace(/(["']?(?:(?:access[_-]?)?token|api[_-]?key|client[_-]?secret|password)["']?\s*[:=]\s*)(?:"[^"]*"|'[^']*'|[^\s,}&"']+)/giu, '$1[REDACTED]')
    .replace(/(?:Bearer|Basic)\s+[^\s,]+/giu, '[REDACTED]')
    .replace(/https?:\/\/[^\s]+/gu, (url) => safeUrl(url) ?? '[REDACTED_URL]');
}
function redactValue(value, key = '') {
  if (/token|api.?key|authorization|cookie|password|secret|credential|session|csrf/i.test(key)) return '[REDACTED]';
  if (Array.isArray(value)) return value.map((item) => redactValue(item));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([name, item]) => [name, redactValue(item, name)]));
  return typeof value === 'string' ? redactText(value) : value;
}
export function safeMessage(value) {
  let candidate = value;
  if (typeof value === 'string') { try { candidate = JSON.parse(value); } catch {} }
  const textValue = typeof candidate === 'object' ? JSON.stringify(redactValue(candidate)) : redactText(candidate ?? 'byCLI command failed');
  return textValue.slice(0, 240);
}

function elapsed(started) { return Math.round(performance.now() - started); }
function text(result) { return `${result?.stderr ?? ''}\n${result?.stdout ?? ''}`.toLowerCase(); }
function errorCode(result) {
  if (result?.timedOut) return 'SOURCE_TIMEOUT';
  if (/auth|login|credential|unauthori[sz]ed/.test(text(result))) return 'AUTH_REQUIRED';
  return 'BROWSER_CONNECT';
}
function parse(result, source, started) {
  if (!result?.ok) return { error: errorEnvelope({ source, code: errorCode(result), message: safeMessage(result?.stderr), elapsedMs: elapsed(started) }) };
  try { return { value: JSON.parse(result.stdout) }; } catch { return { error: errorEnvelope({ source, code: 'PARSE_ERROR', message: 'byCLI returned invalid JSON.', elapsedMs: elapsed(started) }) }; }
}
function capabilities(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || !Array.isArray(value.capabilities) ||
    !value.capabilities.every((entry) => entry && typeof entry === 'object' && typeof entry.id === 'string' && entry.id)) return null;
  return value.capabilities;
}
function available(entries, id) { return entries.some((entry) => entry?.id === id || entry?.name === id || entry?.command?.includes(id)); }
function records(value) {
  const list = Array.isArray(value) ? value : (Array.isArray(value?.data) ? value.data : (Array.isArray(value?.items) ? value.items : null));
  return Array.isArray(list) && list.every((entry) => entry && typeof entry === 'object' && !Array.isArray(entry) &&
    typeof (entry.name ?? entry.slug ?? entry.id) === 'string' && (entry.description === undefined || typeof entry.description === 'string') &&
    (entry.repository === undefined || typeof entry.repository === 'string')) ? list : null;
}
function manual(domain, query) { return { route: 'manual-link', url: `https://${domain}/search?q=${encodeURIComponent(query)}` }; }
function sessionMetadata(session) {
  if (!session || typeof session !== 'object' || Array.isArray(session)) return undefined;
  const safe = {};
  for (const [key, value] of Object.entries(session)) {
    if (PUBLIC_SESSION_KEYS.has(key) && ['string', 'number', 'boolean'].includes(typeof value)) safe[key] = key === 'loginUrl' ? safeUrl(value) : value;
  }
  return Object.keys(safe).length ? safe : undefined;
}
function stopEnvelope({ source, result, started }) {
  const envelope = errorEnvelope({ source, code: 'BROWSER_CONNECT', message: safeMessage(result.stderr || 'Browser session stopped.'), elapsedMs: elapsed(started) });
  const session = sessionMetadata(result.session ?? result.sessionMetadata);
  if (session) envelope.error.session = session;
  return envelope;
}

export function normalizer(id, kinds) {
  return (raw) => ({
    kind: kinds.includes(raw?.kind) ? raw.kind : kinds[0], name: raw?.name ?? raw?.slug ?? raw?.id ?? 'manual-link',
    description: raw?.description ?? null, author: raw?.author ?? null, repository: raw?.repository ?? raw?.repo ?? null,
    path: raw?.path ?? null, version: raw?.version ?? null, sources: [{ source: id }], metrics: { [id]: raw?.metrics ?? {} },
    updatedAt: raw?.updatedAt ?? null, installCommands: {}, security: { status: 'unknown', reasons: [] },
    provenance: { provider: id, retrievedAt: new Date().toISOString(), rawId: String(raw?.id ?? raw?.slug ?? raw?.name ?? 'manual-link') },
    relevance: Number.isFinite(raw?.relevance) ? raw.relevance : null, sourceTrustClass: id === 'github' ? 'unverified' : 'community',
  });
}

export function createAdapter({ id, kinds, domains, clawhub = false, github = false }) {
  const source = { id, kinds, domains };
  const normalize = normalizer(id, kinds);
  async function search({ queries, limit, runner, deadline, signal }) {
    const started = performance.now();
    const query = Array.isArray(queries) && queries[0];
    const aborted = () => signal?.aborted ? errorEnvelope({ source: id, code: 'SOURCE_TIMEOUT', message: 'Source search was aborted.', elapsedMs: elapsed(started) }) : null;
    if (aborted()) return aborted();
    if (typeof query !== 'string' || !query.trim() || typeof runner !== 'function') return errorEnvelope({ source: id, code: 'PARSE_ERROR', message: 'queries and runner are required.', elapsedMs: elapsed(started) });
    if (queries.length > 1) {
      const planned = [...new Set(queries.slice(0, 3).filter((value) => typeof value === 'string' && value.trim()))];
      const envelopes = [];
      for (const plannedQuery of planned) {
        if (signal?.aborted) return errorEnvelope({ source: id, code: 'SOURCE_TIMEOUT', message: 'Source search was aborted.', elapsedMs: elapsed(started) });
        envelopes.push(await search({ queries: [plannedQuery], limit, runner, deadline, signal }));
      }
      const failed = envelopes.find((envelope) => !envelope.ok);
      if (failed) return failed;
      const manualLinks = [...new Map(envelopes.filter((envelope) => envelope.manualLink)
        .map((envelope) => [envelope.manualLink.url, envelope.manualLink])).values()];
      const result = successEnvelope({ source: id, data: envelopes.flatMap((envelope) => envelope.data), warnings: envelopes.flatMap((envelope) => envelope.warnings), elapsedMs: elapsed(started) });
      if (manualLinks.length === 1) result.manualLink = manualLinks[0];
      if (manualLinks.length > 1) result.manualLinks = manualLinks;
      return result;
    }
    const remaining = () => Math.max(1, Number.isFinite(deadline) ? deadline - elapsed(started) : 8_000);
    let listed;
    try { listed = await runner('bycli', ['list', '-f', 'json'], { timeoutMs: remaining(), signal }); } catch (cause) { listed = { ok: false, stderr: cause instanceof Error ? cause.message : 'byCLI failed' }; }
    const discovered = parse(listed, id, started);
    if (discovered.error) return discovered.error;
    if (aborted()) return aborted();
    const caps = capabilities(discovered.value);
    if (!caps) return errorEnvelope({ source: id, code: 'PARSE_ERROR', message: 'byCLI capability payload is malformed.', elapsedMs: elapsed(started) });
    let command = null;
    let args = null;
    if (clawhub) {
      if (aborted()) return aborted();
      if (!available(caps, 'openclaw')) {
        return { ...successEnvelope({ source: id, data: [], warnings: ['BYCLI_CAPABILITY_UNAVAILABLE'], elapsedMs: elapsed(started) }), manualLink: manual(domains[0], query) };
      }
      command = 'openclaw';
      args = ['skills', 'search', query, '--json', '--limit', String(limit)];
    } else if (github && available(caps, 'gh')) { command = 'bycli'; args = ['gh', 'search', query, '-f', 'json', '--limit', String(limit)]; }
    else if (!github && available(caps, id)) { command = 'bycli'; args = [id, 'search', query, '-f', 'json', '--limit', String(limit)]; }
    else if (!github && available(caps, 'search-engine')) { command = 'bycli'; args = ['search-engine', 'search', `site:${domains[0]} ${query}`, '-f', 'json', '--limit', String(limit)]; }
    else if (!github && (available(caps, 'browser') || available(caps, 'web'))) { command = 'bycli'; args = ['web', 'read', `https://${domains[0]}/search?q=${encodeURIComponent(query)}`, '-f', 'json']; }
    else if (github) return errorEnvelope({ source: id, code: 'BROWSER_CONNECT', message: 'byCLI gh capability is unavailable.', elapsedMs: elapsed(started) });
    else return { ...successEnvelope({ source: id, data: [], warnings: ['BYCLI_CAPABILITY_UNAVAILABLE'], elapsedMs: elapsed(started) }), manualLink: manual(domains[0], query) };
    let result;
    if (aborted()) return aborted();
    try { result = await runner(command, args, { timeoutMs: remaining(), signal }); } catch (cause) { result = { ok: false, stderr: cause instanceof Error ? cause.message : 'command failed' }; }
    if (!result?.ok && command === 'bycli' && args[0] === 'web' && /login|captcha|rate|bridge/i.test(text(result))) {
      return stopEnvelope({ source: id, result, started });
    }
    const parsed = parse(result, id, started);
    if (parsed.error) return parsed.error;
    if (aborted()) return aborted();
    const data = records(parsed.value);
    if (!data) return errorEnvelope({ source: id, code: 'PARSE_ERROR', message: 'byCLI result payload is malformed.', elapsedMs: elapsed(started) });
    return successEnvelope({ source: id, data, warnings: [], elapsedMs: elapsed(started) });
  }
  return { source, search, normalize };
}
