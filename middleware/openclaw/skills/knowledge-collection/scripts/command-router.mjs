import {
  cmdInit, cmdPlan, cmdBranch, cmdAggregate, cmdReport, cmdResearchStatus,
} from './research-state.mjs';
import {
  cmdCollect, cmdInspect, cmdRun, cmdCleanup, cmdUnlockStale, cmdSetRetention,
  cmdRewriteImageLinks, cmdExportViews, collectionStatus,
} from './collection-state.mjs';
import {
  cmdCrawlSeed, cmdCrawlNext, cmdCrawlMark, cmdCrawlStatus,
} from './crawl-state.mjs';
import { runPublicDiscover } from './public-discovery.mjs';
import { sessionPaths } from './session.mjs';

const RESEARCH_HANDLERS = {
  init: (args) => cmdInit(args),
  plan: (args) => cmdPlan(args),
  branch: (args) => cmdBranch(args),
  aggregate: (args) => cmdAggregate(args),
  report: (args) => cmdReport(args),
};

const SESSION_HANDLERS = {
  'public-discover': (paths, args) => runPublicDiscover(paths, args),
  collect: (paths, args) => cmdCollect(paths, args),
  inspect: (paths, args) => cmdInspect(paths, args),
  run: (paths, args) => cmdRun(paths, args),
  cleanup: (paths, args) => cmdCleanup(paths, args),
  'crawl-seed': (paths, args) => cmdCrawlSeed(paths, args),
  'crawl-next': (paths, args) => cmdCrawlNext(paths, args),
  'crawl-mark': (paths, args) => cmdCrawlMark(paths, args),
  'crawl-status': (paths) => cmdCrawlStatus(paths),
  'unlock-stale': (paths) => cmdUnlockStale(paths),
  'set-retention': (paths, args) => cmdSetRetention(paths, args),
  'rewrite-image-links': (paths, args) => cmdRewriteImageLinks(paths, args),
  'export-views': (paths) => cmdExportViews(paths),
};

function status(paths, args) {
  const research = cmdResearchStatus(args);
  const full = args.full === true || args.full === 'true';
  if (full) {
    const detail = cmdInspect(paths, { full: true });
    return {
      ok: true,
      action: 'status',
      task: research.task,
      research: research.research,
      collection: detail.metadata,
      canonicalView: detail.collectionResult,
      warnings: [...(research.warnings || []), ...(detail.warnings || [])],
    };
  }
  const collection = collectionStatus(paths);
  return {
    ok: true,
    action: 'status',
    task: research.task,
    research: research.research,
    collection,
    warnings: [...(research.warnings || []), ...(collection.warnings || [])],
  };
}

export function executeLocalCommand(command, args) {
  const researchHandler = RESEARCH_HANDLERS[command];
  if (researchHandler) {
    return researchHandler(args);
  }
  const paths = sessionPaths(args['session-dir']);
  if (command === 'status') {
    return status(paths, args);
  }
  const sessionHandler = SESSION_HANDLERS[command];
  if (sessionHandler) {
    return sessionHandler(paths, args);
  }
  throw new Error(`未知命令: ${command}`);
}
