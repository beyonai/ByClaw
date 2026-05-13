import {
  buildAutoDebugRequestText,
  buildLlmHeaders,
  buildRerankHeaders,
  extractModelId,
  headersListToObject,
  joinUrl,
  normalizeModelType,
} from '../modelFormUtils';

describe('manager/pages/ModelMgr/components/modelFormUtils', () => {
  describe('normalizeModelType', () => {
    it('normalizes numeric and string enum values', () => {
      expect(normalizeModelType(1)).toBe('LLM');
      expect(normalizeModelType('2')).toBe('RERANK');
    });

    it('trims custom string values and falls back to LLM', () => {
      expect(normalizeModelType(' EMBEDDING ')).toBe('EMBEDDING');
      expect(normalizeModelType('')).toBe('LLM');
      expect(normalizeModelType(null)).toBe('LLM');
    });
  });

  describe('joinUrl', () => {
    it('joins base and path without duplicate slashes', () => {
      expect(joinUrl('https://api.example.com/', '/chat/completions')).toBe('https://api.example.com/chat/completions');
      expect(joinUrl('https://api.example.com', 'chat/completions')).toBe('https://api.example.com/chat/completions');
    });

    it('returns whichever side is available', () => {
      expect(joinUrl('', '/chat/completions')).toBe('/chat/completions');
      expect(joinUrl('https://api.example.com', '')).toBe('https://api.example.com');
    });
  });

  describe('headersListToObject', () => {
    it('converts header list to an object and ignores blank keys', () => {
      expect(
        headersListToObject([
          { key: ' Authorization ', value: 'Bearer token' },
          { key: '', value: 'ignored' },
          { key: 'X-App', value: 'manager' },
        ])
      ).toEqual({
        Authorization: 'Bearer token',
        'X-App': 'manager',
      });
    });

    it('returns an empty object for invalid input', () => {
      expect(headersListToObject(null)).toEqual({});
    });
  });

  describe('buildLlmHeaders', () => {
    it('prefers previous Authorization header over form values and token', () => {
      expect(
        buildLlmHeaders({
          formApiToken: 'new-token',
          formHeaders: [
            { key: 'Authorization', value: 'Bearer form-token' },
            { key: 'X-App', value: 'manager' },
          ],
          prevHeaders: { Authorization: 'Bearer prev-token', 'X-Trace': '1' },
        })
      ).toEqual({
        'X-App': 'manager',
        Authorization: 'Bearer prev-token',
      });
    });

    it('falls back to Bearer token when Authorization is absent', () => {
      expect(
        buildLlmHeaders({
          formApiToken: 'token-1',
          formHeaders: [{ key: 'X-App', value: 'manager' }],
        })
      ).toEqual({
        'X-App': 'manager',
        Authorization: 'Bearer token-1',
      });
    });
  });

  describe('buildRerankHeaders', () => {
    it('prefers previous X-Api-Key over form values and token', () => {
      expect(
        buildRerankHeaders({
          formApiToken: 'new-key',
          formHeaders: [
            { key: 'X-Api-Key', value: 'form-key' },
            { key: 'X-App', value: 'manager' },
          ],
          prevHeaders: { 'X-Api-Key': 'prev-key' },
        })
      ).toEqual({
        'X-App': 'manager',
        'X-Api-Key': 'prev-key',
      });
    });

    it('falls back to token when X-Api-Key is absent', () => {
      expect(
        buildRerankHeaders({
          formApiToken: 'key-1',
          formHeaders: [{ key: 'X-App', value: 'manager' }],
        })
      ).toEqual({
        'X-App': 'manager',
        'X-Api-Key': 'key-1',
      });
    });
  });

  describe('buildAutoDebugRequestText', () => {
    it('builds default LLM debug payload', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            apiEndpoint: 'https://api.example.com/v1/',
            apiToken: 'token-1',
            modelCode: 'gpt-4o',
            headers: [{ key: 'X-App', value: 'manager' }],
          },
          defaultUserMessage: 'hello',
        })
      );

      expect(result).toEqual({
        url: 'https://api.example.com/v1/chat/completions',
        headers: {
          'X-App': 'manager',
          Authorization: 'Bearer token-1',
        },
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hello' }],
        temperature: 0.1,
        stream: true,
      });
    });

    it('preserves previous llm suffix, messages and extra keys when not switching type', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            apiEndpoint: 'https://api.example.com/v2',
            apiToken: '',
            modelCode: 'gpt-4o-mini',
            headers: [],
          },
          prevText: JSON.stringify({
            url: 'https://api.example.com/v2/responses',
            headers: { Authorization: 'Bearer prev-token' },
            messages: [{ role: 'assistant', content: 'cached' }],
            temperature: 0.5,
            stream: false,
            customFlag: true,
          }),
          changedKeys: ['apiEndpoint'],
          previousApiEndpoint: 'https://api.example.com/v1',
        })
      );

      expect(result.url).toBe('https://api.example.com/v2/responses');
      expect(result.headers).toEqual({ Authorization: 'Bearer prev-token' });
      expect(result.messages).toEqual([{ role: 'assistant', content: 'cached' }]);
      expect(result.temperature).toBe(0.5);
      expect(result.stream).toBe(false);
    });

    it('uses raw previous text as a user message when previous text is not valid json', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            apiEndpoint: 'https://api.example.com/v1',
            modelCode: 'gpt-4o',
            headers: [],
          },
          prevText: 'plain input text',
        })
      );

      expect(result.messages).toEqual([{ role: 'user', content: 'plain input text' }]);
    });

    it('builds rerank debug payload and normalizes endpoint suffix', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'RERANK',
            apiEndpoint: 'https://api.example.com/r/e/r/a/n/k/rerank',
            apiToken: 'api-key',
            modelCode: 'rerank-v1',
            headers: [{ key: 'X-App', value: 'manager' }],
          },
          defaultRerankQuery: 'beijing',
          defaultRerankDocs: [
            { text: 'doc1', metadata: { id: 1 }, score: 0 },
            { text: 'doc2', metadata: { id: 2 }, score: 0 },
            { text: 'doc3', metadata: { id: 3 }, score: 0 },
            { text: 'doc4', metadata: { id: 4 }, score: 0 },
          ],
        })
      );

      expect(result).toEqual({
        url: 'https://api.example.com/rerank',
        headers: {
          'X-App': 'manager',
          'X-Api-Key': 'api-key',
        },
        model: 'rerank-v1',
        query: 'beijing',
        docs: [
          { text: 'doc1', metadata: { id: 1 }, score: 0 },
          { text: 'doc2', metadata: { id: 2 }, score: 0 },
          { text: 'doc3', metadata: { id: 3 }, score: 0 },
          { text: 'doc4', metadata: { id: 4 }, score: 0 },
        ],
      });
    });

    it('builds generic debug payload for custom model types', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'EMBEDDING',
            apiEndpoint: 'https://api.example.com/embed',
            apiToken: 'token',
            modelCode: 'text-embedding-3',
            headers: [{ key: 'X-App', value: 'manager' }],
            connectTimeoutSec: 30,
            readTimeoutSec: 60,
            temperature: 0.2,
            maxTokens: 128,
            topP: 0.8,
          },
          id: 'debug-1',
          prevText: JSON.stringify({
            input: 'hello',
            variables: { locale: 'zh-CN' },
            preserved: true,
          }),
        })
      );

      expect(result).toEqual({
        url: 'https://api.example.com/embed/embeddings',
        headers: { Authorization: 'Bearer token', 'X-App': 'manager' },
        model: 'text-embedding-3',
        input: 'hello',
      });
    });
  });

  describe('extractModelId', () => {
    it('extracts model id from common response shapes', () => {
      expect(extractModelId({ data: { id: 'model-1' } })).toBe('model-1');
      expect(extractModelId({ id: 'model-2' })).toBe('model-2');
      expect(extractModelId({ resourceId: 'model-3' })).toBe('model-3');
    });

    it('falls back through nested fields and returns undefined when absent', () => {
      expect(extractModelId({ data: { resourceId: 'model-4' } })).toBe('model-4');
      expect(extractModelId({ result: { id: 'model-5' } })).toBe('model-5');
      expect(extractModelId({})).toBeUndefined();
    });
  });
});
