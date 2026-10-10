import { runCli } from '../enterprise/shared/cli-runner.mjs';

const DEFAULT_PROCESS_TIMEOUT_MS = 60_000;
const REQUEST_TIMEOUT_SECONDS = 10;
const RUNTIME_SCRIPT = '/opt/searxng-cli/searxng_cli.py';

export function resolveSearxngRuntime(options = {}, environment = process.env) {
  const pythonExecutable = options.pythonExecutable || environment.ONLINE_SEARCH_PYTHON;
  if (pythonExecutable) {
    const script = options.searxngScript || environment.ONLINE_SEARCH_SCRIPT || RUNTIME_SCRIPT;
    return { executable: pythonExecutable, argsPrefix: [script] };
  }
  return { executable: 'searxng-cli', argsPrefix: [] };
}

function parseDocument(outcome) {
  if (!outcome || outcome.code !== 0 || typeof outcome.stdout !== 'string') return null;
  try {
    const document = JSON.parse(outcome.stdout);
    return document && typeof document === 'object' && !Array.isArray(document)
      && Array.isArray(document.results) ? document : null;
  } catch {
    return null;
  }
}

async function defaultProcess(spec, options) {
  const result = await runCli(spec.executable, spec.args, options);
  return { code: result.exitCode, stdout: result.stdout, stderr: result.stderr };
}

function safeMessage(value) {
  return String(value || 'SearXNG failed')
    .replace(/((?:authorization|cookie|credential|password|secret|token)\s*(?:=|:)\s*)(?:Bearer\s+)?[^\s,;]+/gi, '$1[REDACTED]')
    .slice(0, 1_000);
}

export async function runSearxng(args, options = {}) {
  const runtime = resolveSearxngRuntime(options, options.environment || process.env);
  const processTimeoutMs = Number.isSafeInteger(options.timeoutMs) && options.timeoutMs > 0
    ? options.timeoutMs : DEFAULT_PROCESS_TIMEOUT_MS;
  const spec = {
    channel: 'searxng',
    executable: runtime.executable,
    args: [
      ...runtime.argsPrefix,
      args.query,
      '--category', args.category || 'general',
      '--language', args.language || 'all',
      '--pageno', String(args.pageno || '1'),
      '--max-results', String(args['max-results'] || '20'),
      '--timeout', String(REQUEST_TIMEOUT_SECONDS),
      ...(args['time-range'] ? ['--time-range', args['time-range']] : []),
    ],
  };
  try {
    const outcome = await (options.runProcess || defaultProcess)(spec, { timeoutMs: processTimeoutMs });
    const document = parseDocument(outcome);
    if (!document) {
      return {
        ok: false,
        error: {
          category: 'provider',
          code: 'SEARXNG_FAILED',
          retryable: true,
          message: safeMessage(outcome?.stderr || 'SearXNG returned an invalid response'),
        },
      };
    }
    return { ok: true, document };
  } catch (error) {
    return {
      ok: false,
      error: {
        category: /timeout/i.test(error?.message || '') ? 'timeout' : 'provider',
        code: /timeout/i.test(error?.message || '') ? 'SEARXNG_TIMEOUT' : 'SEARXNG_FAILED',
        retryable: true,
        message: safeMessage(error instanceof Error ? error.message : error),
      },
    };
  }
}
