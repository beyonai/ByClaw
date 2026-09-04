import {
  cmdInit, cmdPlan, cmdBranch, cmdAggregate, cmdReport, cmdResearchStatus,
} from './research-state.mjs';
import {
  cmdCollect, cmdInspect, cmdUnlockStale, cmdExportViews, collectionStatus,
} from './collection-state.mjs';
import {
  cmdCrawlSeed, cmdCrawlNext, cmdCrawlMark, cmdCrawlStatus,
} from './crawl-state.mjs';
import { runPublicDiscover } from './public-discovery.mjs';
import { runPublicCollect } from './public-collect.mjs';
import { runWechatMaterialize } from './wechat-materializer.mjs';
import { runArxivMaterialize } from './arxiv-materializer.mjs';
import { runWebAcquire } from './web-acquirer.mjs';
import { runWebMaterialize } from './web-materializer.mjs';
import { cmdPublish, inspectDelivery } from './publish-delivery.mjs';
import { cmdRetighten } from './granularity-repair.mjs';
import { assertExternalSessionWriteAllowed } from './probe-state.mjs';
import { resolveSandboxPath, sessionPaths } from './session.mjs';

const READ_ONLY_SESSION_COMMANDS = new Set(['status', 'inspect', 'crawl-status']);

const RESEARCH_HANDLERS = {
  init: (args) => cmdInit(args),
  plan: (args) => cmdPlan(args),
  branch: (args) => cmdBranch(args),
  aggregate: (args) => cmdAggregate(args),
  report: (args) => cmdReport(args),
};

const SESSION_HANDLERS = {
  'public-discover': (paths, args) => runPublicDiscover(paths, args),
  'public-collect': (paths, args) => runPublicCollect(paths, args),
  'acquire-web': (paths, args) => runWebAcquire(paths, args),
  'materialize-web': (paths, args) => runWebMaterialize(paths, args),
  'materialize-wechat': (paths, args) => runWechatMaterialize(paths, args),
  'materialize-arxiv': (paths, args) => runArxivMaterialize(paths, args),
  collect: (paths, args) => cmdCollect(paths, args),
  inspect: (paths, args) => cmdInspect(paths, args),
  'crawl-seed': (paths, args) => cmdCrawlSeed(paths, args),
  'crawl-next': (paths, args) => cmdCrawlNext(paths, args),
  'crawl-mark': (paths, args) => cmdCrawlMark(paths, args),
  'crawl-status': (paths) => cmdCrawlStatus(paths),
  'unlock-stale': (paths) => cmdUnlockStale(paths),
  'export-views': (paths) => cmdExportViews(paths),
  publish: (paths, args) => cmdPublish(paths, args),
  retighten: (paths, args) => cmdRetighten(paths, args),
};

function status(paths, args) {
  const research = cmdResearchStatus(args);
  const collection = collectionStatus(paths);
  const {
    downstreamInput,
    crawl,
    warnings: collectionWarnings = [],
    ...collectionSummary
  } = collection;
  const full = args.full === true || args.full === 'true';
  const published = inspectDelivery(paths);
  if (full) {
    const detail = cmdInspect(paths, { full: true });
    return {
      ok: true,
      action: 'status',
      task: research.task,
      research: research.research,
      collection: { ...detail.metadata, ...collectionSummary },
      canonicalView: detail.collectionResult,
      downstreamInput,
      ...(published.deliveryInput ? { deliveryInput: published.deliveryInput } : {}),
      ...(crawl ? { crawl } : {}),
      warnings: [...(research.warnings || []), ...collectionWarnings, ...(detail.warnings || []), ...published.warnings],
    };
  }
  return {
    ok: true,
    action: 'status',
    task: research.task,
    research: research.research,
    collection: collectionSummary,
    ...(crawl ? { crawl } : {}),
    downstreamInput,
    ...(published.deliveryInput ? { deliveryInput: published.deliveryInput } : {}),
    warnings: [...(research.warnings || []), ...collectionWarnings, ...published.warnings],
  };
}

export function executeLocalCommand(command, args) {
  const normalizedArgs = {
    ...args,
    'session-dir': resolveSandboxPath(args['session-dir'], '--session-dir', {
      currentSessionRoot: args['session-root'],
    }),
  };
  const researchHandler = RESEARCH_HANDLERS[command];
  if (researchHandler) {
    return researchHandler(normalizedArgs);
  }
  const paths = sessionPaths(normalizedArgs['session-dir']);
  if (command === 'status') {
    return status(paths, normalizedArgs);
  }
  const sessionHandler = SESSION_HANDLERS[command];
  if (sessionHandler) {
    if (!READ_ONLY_SESSION_COMMANDS.has(command) && command !== 'public-collect') {
      assertExternalSessionWriteAllowed(paths, command);
    }
    return sessionHandler(paths, normalizedArgs);
  }
  throw new Error(`未知命令: ${command}`);
}
