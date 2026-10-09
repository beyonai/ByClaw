import fs from 'node:fs';
import path from 'node:path';
import { loadSession, sessionPaths } from '../session.mjs';
import { cmdPlan, cmdBranch, cmdAggregate, wordCount } from '../research-state.mjs';
import { canonicalizeUrl, cmdCrawlNext, cmdCrawlSeed, extractUrls } from '../crawl-state.mjs';
import { prioritizeItems } from './selection.mjs';
import { prioritizeGroups } from './group-selection.mjs';
import { withAdvisoryCache } from './advisory-cache.mjs';
import { publicOnlyTask } from './safe-call.mjs';

const snapshot = (session) => JSON.stringify({ task: session.task, research: session.research });
const sessionUnchanged = (paths, session) => () => JSON.stringify(loadSession(paths, { persistMigration: false }).session)
  === JSON.stringify(session);
const sessionOptions = (session, options) => ({ ...options, privateData: !publicOnlyTask(session.task),
  remainingBudgetMs: () => Math.min(options.remainingBudgetMs ? options.remainingBudgetMs() : Infinity,
    session.task.deadlineMinutes ? Math.max(0, Date.parse(session.task.startedAt)
      + session.task.deadlineMinutes * 60000 - Date.now()) : Infinity) });

function urlGroup(url) {
  const parsed = new URL(url);
  const section = parsed.pathname.split('/').filter(Boolean)[0] || '/';
  return { key: `${parsed.origin}/${section}`, title: `${parsed.hostname}/${section}` };
}

export async function runResearchUpdate(command, args, options = {}) {
  const result = command === 'plan' ? cmdPlan(args) : cmdBranch(args);
  const paths = sessionPaths(args['session-dir']);
  const { session } = loadSession(paths, { persistMigration: false });
  const branches = session.research.branches;
  const answered = new Set(branches.filter((branch) => branch.status === 'done').map((branch) => branch.query));
  const followups = [...new Set([...(session.task.followups || []),
    ...branches.filter((branch) => branch.status === 'done').flatMap((branch) => branch.followups || [])])]
    .filter((question) => !answered.has(question));
  const rows = followups.map((title, index) => ({ title, index }));
  const selectionOptions = {
    ...sessionOptions(session, options), purpose: 'Choose which existing research question to investigate next; favor uncovered evidence. Do not declare the research complete or skip required depth.',
    context: (session.research.learnings || []).slice(-20).join('\n'),
  };
  const ranked = await withAdvisoryCache(paths, 'research-update', session, rows, selectionOptions,
    () => prioritizeItems(session.task.query, rows, selectionOptions), null, sessionUnchanged(paths, session));
  const current = loadSession(paths, { persistMigration: false }).session;
  if (snapshot(current) !== snapshot(session)) return { ...result, researchSelection: { status: 'fallback', code: 'CONTEXT_CHANGED' } };
  return { ...result, suggestedFollowups: ranked.items.map((row) => row.title), researchSelection: ranked.diagnostic };
}

export async function runResearchAggregate(args, options = {}) {
  const paths = sessionPaths(args['session-dir']);
  const { session } = loadSession(paths, { persistMigration: false });
  if (!session.research.branches.length || wordCount(session.research.context) <= Number(session.task.maxContextWords ?? 25000)) {
    return cmdAggregate(args);
  }
  const rows = session.research.context.map((text, index) => ({ text, index }));
  const selectionOptions = { ...sessionOptions(session, options),
    purpose: 'Select existing evidence for a limited research context. Prioritize key findings, counterexamples, unresolved questions and citation-bearing evidence; demote repetitions. Never rewrite evidence.',
  };
  const ranked = await withAdvisoryCache(paths, 'research-aggregate', session, rows, selectionOptions,
    () => prioritizeItems(session.task.query, rows, selectionOptions), null, sessionUnchanged(paths, session));
  const expectedState = snapshot(session);
  const unchanged = snapshot(loadSession(paths, { persistMigration: false }).session) === expectedState;
  const result = cmdAggregate(args, ranked.diagnostic.status === 'used' && unchanged
    ? { expectedState, indices: ranked.items.map((row) => row.index) } : {});
  return { ...result, contextSelection: unchanged ? ranked.diagnostic : { status: 'fallback', code: 'CONTEXT_CHANGED' } };
}

export async function runCrawlNext(paths, args, options = {}) {
  const baseline = cmdCrawlNext(paths, args);
  const { session } = loadSession(paths, { persistMigration: false });
  // Exhaustive archiving cannot save downloads by choosing a subset.
  if (session.task.materializationTarget === 'all') return baseline;
  const pending = session.crawl?.entries;
  if (!pending) return baseline;
  const rows = pending.filter((entry) => entry.status === 'pending').map((entry) => {
    const url = new URL(entry.url);
    return { title: `${url.hostname}${url.pathname}`, url: entry.url };
  });
  if (rows.length <= baseline.urls.length) return baseline;
  const selectionOptions = rows.length > 96 ? {
      ...sessionOptions(session, options),
      purpose: 'Prioritize authorized website path groups most likely to answer the topic. Every page remains in the queue.',
    } : {
    ...sessionOptions(session, options), purpose: 'Prioritize already authorized website pages most likely to answer the topic, using path evidence. Prefer substantive documentation over navigation. Every page remains in the queue.',
  };
  const ranked = await withAdvisoryCache(paths, 'crawl-next', session, rows, selectionOptions,
    () => rows.length > 96 ? prioritizeGroups(session.task.query, rows, (row) => urlGroup(row.url), selectionOptions)
      : prioritizeItems(session.task.query, rows, selectionOptions), null, sessionUnchanged(paths, session));
  const current = loadSession(paths, { persistMigration: false }).session;
  if (JSON.stringify(current) !== JSON.stringify(session)) {
    return { ...cmdCrawlNext(paths, args), candidateRanking: { status: 'fallback', code: 'CONTEXT_CHANGED' } };
  }
  return { ...baseline, urls: ranked.items.slice(0, baseline.urls.length).map((row) => row.url), candidateRanking: ranked.diagnostic };
}

export async function runCrawlSeed(paths, args, options = {}) {
  let session;
  let urlsFile;
  let sourceText;
  try {
    session = loadSession(paths, { persistMigration: false }).session;
    if (session.task.materializationTarget === 'all') return cmdCrawlSeed(paths, args);
    urlsFile = path.resolve(args['urls-file']);
    sourceText = fs.readFileSync(urlsFile, 'utf8');
  } catch {
    return cmdCrawlSeed(paths, args);
  }
  const rawUrls = extractUrls(sourceText);
  const scopePrefix = args['scope-prefix'] && args['scope-prefix'] !== true
    ? canonicalizeUrl(args['scope-prefix']) : session.crawl?.scopePrefix;
  const eligible = rawUrls.flatMap((raw, index) => {
    try {
      const url = canonicalizeUrl(raw);
      return !scopePrefix || url.startsWith(scopePrefix) ? [{ raw, url, index }] : [];
    } catch { return []; }
  });
  if (eligible.length < 2) return cmdCrawlSeed(paths, args);
  const selectionOptions = {
      ...sessionOptions(session, options),
      purpose: 'Prioritize already authorized website path groups before page admission. Keep every supplied URL.',
    };
  const ranked = await withAdvisoryCache(paths, 'crawl-seed', session, eligible, selectionOptions,
    () => prioritizeGroups(session.task.query, eligible, (row) => urlGroup(row.url), selectionOptions), sourceText,
    () => sessionUnchanged(paths, session)() && fs.readFileSync(urlsFile, 'utf8') === sourceText);
  if (ranked.diagnostic.status !== 'used') return cmdCrawlSeed(paths, args);
  if (JSON.stringify(loadSession(paths, { persistMigration: false }).session) !== JSON.stringify(session)
    || fs.readFileSync(urlsFile, 'utf8') !== sourceText) return cmdCrawlSeed(paths, args);
  const reordered = rawUrls.slice();
  eligible.forEach((row, index) => { reordered[row.index] = ranked.items[index].raw; });
  return cmdCrawlSeed(paths, args, { orderedRawUrls: reordered });
}
