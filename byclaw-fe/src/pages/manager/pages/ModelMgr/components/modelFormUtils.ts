import type { IntlShape } from 'react-intl';

export type DebugInputMode = 'template' | 'auto';

export type ModelTagItem = {
  param_name?: string;
  param_value?: string;
  standDisplayValue?: string;
  standCode?: string;
  [key: string]: any;
};

export const SYSTEM_SOURCE_TYPES = ['DIG_EMPLOYEE'];

export const tokenMarks = {
  1000: '1K',
  50000: '50K',
  100000: '100K',
  200000: '200K',
};

export function buildDebugDefaults(intl: IntlShape) {
  return {
    defaultUserMessage: intl.formatMessage({ id: 'modelMgr.modal.debugDefaultUserMessage' }),
    defaultRerankQuery: intl.formatMessage({ id: 'modelMgr.modal.debugRerankQuery' }),
    defaultRerankDocs: [
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc1' }), metadata: { id: 0 }, score: 0 },
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc2' }), metadata: { id: 1 }, score: 0 },
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc3' }), metadata: { id: 2 }, score: 0 },
      { text: intl.formatMessage({ id: 'modelMgr.modal.debugRerankDoc4' }), metadata: { id: 3 }, score: 0 },
    ],
  };
}

export function getDefaultFormValues() {
  return {
    status: 'ENABLED',
    abilities: [],
    systems: [],
    modelType: 'LLM',
    apiEndpoint: 'https://api.example.com/v1',
    headers: [{ key: '', value: '' }],
    connectTimeoutSec: 32,
    readTimeoutSec: 60,
    maxRetries: 3,
    retryIntervalSec: 1,
    contextTokens: 128000,
    temperature: 0.7,
    topP: 0.9,
    maxTokens: 1024,
    frequencyPenalty: 0,
    presencePenalty: 0,
  };
}

export function normalizeModelType(v: any) {
  if (v === 1 || v === '1') return 'LLM';
  if (v === 2 || v === '2') return 'RERANK';
  if (typeof v === 'string' && v.trim()) return v.trim();
  return 'LLM';
}

export function joinUrl(base: string, path: string) {
  const b = `${base || ''}`.trim().replace(/\/+$/, '');
  const p = `${path || ''}`.trim();
  if (!b) return p || '';
  if (!p) return b;
  if (p.startsWith('/')) return `${b}${p}`;
  return `${b}/${p}`;
}

function normalizeRerankBase(apiEndpoint: string) {
  let base = `${apiEndpoint || ''}`.trim();
  base = base.replace(/\/r\/e\/r\/a\/n\/k(\/rerank)?\/?$/i, '');
  base = base.replace(/\/rerank\/?$/i, '');
  base = base.replace(/\/+$/, '');
  return base;
}

function normalizeRerankSuffix(suffix: string) {
  let s = `${suffix || ''}`.trim();
  if (!s) return '/rerank';
  s = s.replace(/\/r\/e\/r\/a\/n\/k/gi, '/rerank');
  s = s.replace(/\/rerank(\/rerank)+/gi, '/rerank');
  if (!s.startsWith('/')) s = `/${s}`;
  return s;
}

export function headersListToObject(list: any) {
  const arr = Array.isArray(list) ? list : [];
  const obj: Record<string, string> = {};
  arr.forEach((it) => {
    const k = `${it?.key ?? ''}`.trim();
    const v = `${it?.value ?? ''}`;
    if (!k) return;
    obj[k] = v;
  });
  return obj;
}

export function buildLlmHeaders(options: { formApiToken?: any; formHeaders?: any; prevHeaders?: any }) {
  const { formApiToken, formHeaders, prevHeaders } = options;
  const formObj = headersListToObject(formHeaders);
  const prevObj =
    prevHeaders && typeof prevHeaders === 'object' && !Array.isArray(prevHeaders) ? (prevHeaders as any) : {};

  const next: Record<string, string> = {};
  const authFromPrev = typeof prevObj.Authorization === 'string' ? prevObj.Authorization : '';
  const authFromFormHeader = typeof formObj.Authorization === 'string' ? formObj.Authorization : '';
  const token = `${formApiToken ?? ''}`.trim();
  const authFromToken = token ? `Bearer ${token}` : '';
  const auth = authFromFormHeader || authFromToken || authFromPrev;

  Object.keys(formObj).forEach((k) => {
    if (k === 'Authorization') return;
    next[k] = formObj[k];
  });
  if (auth) next.Authorization = auth;

  return next;
}

export function buildRerankHeaders(options: { formApiToken?: any; formHeaders?: any; prevHeaders?: any }) {
  const { formApiToken, formHeaders, prevHeaders } = options;
  const formObj = headersListToObject(formHeaders);
  const prevObj =
    prevHeaders && typeof prevHeaders === 'object' && !Array.isArray(prevHeaders) ? (prevHeaders as any) : {};

  const next: Record<string, string> = {};
  const keyFromPrev = typeof prevObj['X-Api-Key'] === 'string' ? prevObj['X-Api-Key'] : '';
  const keyFromFormHeader = typeof formObj['X-Api-Key'] === 'string' ? formObj['X-Api-Key'] : '';
  const token = `${formApiToken ?? ''}`.trim();
  const keyFromToken = token ? `${token}` : '';
  const apiKey = keyFromFormHeader || keyFromToken || keyFromPrev;

  Object.keys(formObj).forEach((k) => {
    if (k === 'X-Api-Key') return;
    next[k] = formObj[k];
  });
  if (apiKey) next['X-Api-Key'] = apiKey;

  return next;
}

function safeParseJsonObject(text: string): any | null {
  try {
    const parsed = JSON.parse(text);
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;
    return parsed;
  } catch (e) {
    return null;
  }
}

export function buildAutoDebugRequestText(options: {
  formValues: any;
  id?: string;
  prevText?: string;
  changedKeys?: string[];
  previousApiEndpoint?: string;
  defaultUserMessage?: string;
  defaultRerankQuery?: string;
  defaultRerankDocs?: Array<{ text: string; metadata: { id: number }; score: number }>;
}) {
  const {
    formValues,
    id,
    prevText,
    changedKeys,
    previousApiEndpoint,
    defaultUserMessage,
    defaultRerankQuery,
    defaultRerankDocs,
  } = options;
  const prevObj = prevText ? safeParseJsonObject(prevText) : null;
  const modelType = normalizeModelType(formValues?.modelType);
  const isTypeSwitch = Array.isArray(changedKeys) && changedKeys.includes('modelType');
  console.log(formValues);
  if (modelType === 'LLM') {
    const apiEndpoint = `${formValues?.apiEndpoint ?? ''}`.trim();
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/chat/completions';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (!isTypeSwitch && endpointNotShortened && prevUrl && apiEndpoint && prevUrl.startsWith(apiEndpoint)) {
      suffix = prevUrl.slice(apiEndpoint.length) || '';
    }
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildLlmHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultMessages = [{ role: 'user', content: defaultUserMessage ?? '今天天气如何' }];
    const messages =
      !isTypeSwitch && Array.isArray(prevObj?.messages) && prevObj.messages.length
        ? prevObj.messages
        : prevText && `${prevText}`.trim() && !prevObj
          ? [{ role: 'user', content: `${prevText}` }]
          : defaultMessages;

    const temperature = !isTypeSwitch && typeof prevObj?.temperature === 'number' ? prevObj.temperature : 0.1;
    const stream = !isTypeSwitch && typeof prevObj?.stream === 'boolean' ? prevObj.stream : true;

    return JSON.stringify(
      {
        url,
        headers: Object.keys(headersObj).length ? headersObj : {},
        model: modelNoOrCode,
        messages,
        temperature,
        stream,
      },
      null,
      2
    );
  }

  if (modelType === 'RERANK') {
    const apiEndpointRaw = `${formValues?.apiEndpoint ?? ''}`.trim();
    const apiEndpoint = normalizeRerankBase(apiEndpointRaw);
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/rerank';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (!isTypeSwitch && endpointNotShortened && prevUrl && apiEndpoint && prevUrl.startsWith(apiEndpoint)) {
      suffix = prevUrl.slice(apiEndpoint.length) || '';
    }
    suffix = normalizeRerankSuffix(suffix);
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildRerankHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultQuery = defaultRerankQuery ?? '北京旅游攻略';
    const defaultDocs =
      defaultRerankDocs && defaultRerankDocs.length >= 4
        ? defaultRerankDocs
        : [
          { text: '北京美食推荐', metadata: { id: 0 }, score: 0 },
          { text: '天津旅游攻略', metadata: { id: 1 }, score: 0 },
          { text: '小白开发教程', metadata: { id: 2 }, score: 0 },
          { text: '故宫游玩攻略', metadata: { id: 3 }, score: 0 },
        ];

    const query =
      !isTypeSwitch && typeof prevObj?.query === 'string' && prevObj.query.trim() ? prevObj.query : defaultQuery;
    const docs = !isTypeSwitch && Array.isArray(prevObj?.docs) && prevObj.docs.length ? prevObj.docs : defaultDocs;

    const req: Record<string, any> = {
      url,
      headers: Object.keys(headersObj).length ? headersObj : {},
      model: modelNoOrCode,
      query,
      docs,
    };

    if (!isTypeSwitch && prevObj) {
      const knownKeys = Object.keys(req);
      Object.keys(prevObj)
        .filter((k) => !knownKeys.includes(k))
        .filter((k) => !['messages', 'stream', 'temperature'].includes(k))
        .sort()
        .forEach((k) => {
          req[k] = prevObj[k];
        });
    }

    return JSON.stringify(req, null, 2);
  }

  if (modelType === 'EMBEDDING') {
    const apiEndpoint = `${formValues?.apiEndpoint ?? ''}`.trim();
    const prevUrl = typeof prevObj?.url === 'string' ? prevObj.url.trim() : '';
    let suffix = '/embeddings';
    const endpointNotShortened = !previousApiEndpoint || apiEndpoint.length >= previousApiEndpoint.length;
    if (!isTypeSwitch && endpointNotShortened && prevUrl && apiEndpoint && prevUrl.startsWith(apiEndpoint)) {
      suffix = prevUrl.slice(apiEndpoint.length) || '';
    }
    const url = joinUrl(apiEndpoint, suffix);

    const headersObj = buildLlmHeaders({
      formApiToken: formValues?.apiToken,
      formHeaders: formValues?.headers,
      prevHeaders: prevObj?.headers,
    });
    const modelNoOrCode = `${formValues?.model_no ?? formValues?.modelCode ?? ''}`.trim();
    const defaultInput = '今天天气如何';
    const inputText =
      !isTypeSwitch && typeof prevObj?.input === 'string' && prevObj.input.trim() ? prevObj.input : defaultInput;

    return JSON.stringify(
      {
        url,
        headers: Object.keys(headersObj).length ? headersObj : {},
        model: modelNoOrCode,
        input: inputText,
      },
      null,
      2
    );
  }

  const prevInput =
    typeof prevObj?.input === 'string' ? prevObj.input : prevText && `${prevText}`.trim() ? `${prevText}` : '';
  const prevVariables =
    prevObj?.variables && typeof prevObj.variables === 'object' && !Array.isArray(prevObj.variables)
      ? prevObj.variables
      : {};

  const req: Record<string, any> = {
    ...(id ? { id } : undefined),
    input: prevInput,
    variables: prevVariables,
    apiEndpoint: formValues?.apiEndpoint ?? '',
    apiToken: formValues?.apiToken ?? '',
    modelCode: formValues?.modelCode ?? 'gpt-3.5-turbo',
    modelType,
    headers: Array.isArray(formValues?.headers) ? formValues.headers : [],
    connectTimeoutSec: formValues?.connectTimeoutSec,
    readTimeoutSec: formValues?.readTimeoutSec,
    temperature: formValues?.temperature,
    maxTokens: formValues?.maxTokens,
    topP: formValues?.topP,
  };

  if (prevObj) {
    const knownKeys = Object.keys(req);
    Object.keys(prevObj)
      .filter((k) => !knownKeys.includes(k))
      .sort()
      .forEach((k) => {
        req[k] = prevObj[k];
      });
  }

  return JSON.stringify(req, null, 2);
}

export function extractModelId(res: any) {
  return res?.data?.id ?? res?.id ?? res?.resourceId ?? res?.data?.resourceId ?? res?.result?.id ?? undefined;
}
