import { callTypeSafeJev } from './typesafe.mjs';

function indexed(values, prefix) {
  return Object.fromEntries(values.map((value, index) => [`${prefix}${index}`, value === null ? 'no time limit' : String(value)]));
}

function selected(answer, values, prefix) {
  if (!answer || answer.type !== 'choice' || typeof answer.choice !== 'string') return undefined;
  const match = new RegExp(`^${prefix}(\\d+)$`).exec(answer.choice);
  if (!match) return undefined;
  const index = Number(match[1]);
  return index >= 0 && index < values.length ? values[index] : undefined;
}

function confidence(answer) {
  return Number.isFinite(answer?.confidence) ? answer.confidence : 0;
}

function legacy(input) {
  return {
    query: input.query,
    category: input.category,
    language: input.language,
    timeRange: input.timeRange ?? null,
    source: 'automatic',
  };
}

export async function planDiscovery(input, options = {}) {
  const callJev = options.callJev || callTypeSafeJev;
  const queryCandidates = input.queryCandidates?.length ? input.queryCandidates : [input.query];
  const categoryCandidates = input.categoryCandidates?.length ? input.categoryCandidates : [input.category];
  const timeRangeCandidates = input.timeRangeCandidates?.length ? input.timeRangeCandidates : [input.timeRange ?? null];
  const sourceCandidates = input.sourceCandidates?.length ? input.sourceCandidates : ['automatic'];
  const questions = {
    query: { type: 'choice', instructions: 'Choose the best bounded web-search query for the request.', criteria: indexed(queryCandidates, 'q') },
    category: { type: 'choice', instructions: 'Choose the best bounded search category for the request.', criteria: indexed(categoryCandidates, 'c') },
    timeRange: { type: 'choice', instructions: 'Choose the bounded time range explicitly requested or clearly implied.', criteria: indexed(timeRangeCandidates, 't') },
    source: { type: 'choice', instructions: 'Choose the best bounded source preference; use automatic when none is requested.', criteria: indexed(sourceCandidates, 's') },
  };
  const response = await callJev({
    state: { request: input.request || input.query, candidates: { queryCandidates, categoryCandidates, timeRangeCandidates, sourceCandidates } },
    questions,
  }, options);
  if (!response?.ok) {
    const rawStatus = response?.diagnostic?.status;
    const status = rawStatus === 'unavailable' || rawStatus === 'disabled' ? rawStatus : 'fallback';
    return { effective: legacy(input), jev: { status, code: response?.diagnostic?.code || 'TYPESAFE_PLANNING_FAILED' } };
  }
  const answers = response.document?.answers || {};
  const query = selected(answers.query, queryCandidates, 'q');
  const category = selected(answers.category, categoryCandidates, 'c');
  const timeRange = selected(answers.timeRange, timeRangeCandidates, 't');
  const source = selected(answers.source, sourceCandidates, 's');
  if (query === undefined || category === undefined || timeRange === undefined || source === undefined) {
    return { effective: legacy(input), jev: { status: 'fallback', code: 'TYPESAFE_PLANNING_INVALID' } };
  }
  return {
    effective: { query, category, language: input.language, timeRange, source },
    jev: {
      status: 'used',
      model: response.document.model,
      confidence: {
        query: confidence(answers.query),
        category: confidence(answers.category),
        timeRange: confidence(answers.timeRange),
        source: confidence(answers.source),
      },
    },
  };
}
