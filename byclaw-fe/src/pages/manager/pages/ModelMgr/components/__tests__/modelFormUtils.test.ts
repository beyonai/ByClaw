import {
  buildAutoDebugRequestText,
  buildDebugPayload,
  dispatchModelActionWithResult,
  buildLlmHeaders,
  buildModelUpsertPayload,
  buildReasoningConfigPayload,
  buildRerankHeaders,
  extractModelId,
  getDefaultFormValues,
  getDefaultLlmDebugSuffix,
  getModelDebugDispatchTimeoutMs,
  getApiEndpointPlaceholder,
  getModelTypeSwitchFormValues,
  getModelTypeTransitionFormValues,
  hasImageGenerationPrompt,
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
      expect(normalizeModelType(' IMAGE_GENERATION ')).toBe('IMAGE_GENERATION');
      expect(normalizeModelType('')).toBe('LLM');
      expect(normalizeModelType(null)).toBe('LLM');
    });
  });

  describe('buildDebugPayload', () => {
    it('builds the MiniMax image generation debug contract with safe defaults', () => {
      expect(
        buildDebugPayload({
          modelType: 'IMAGE_GENERATION',
          modelCode: 'image-01',
          prompt: 'whale',
          apiToken: 'test-api-token',
        })
      ).toEqual({
        input: {
          providerName: 'MINIMAX',
          modelProtocol: 'MINIMAX_IMAGE',
          url: 'https://api.minimaxi.com/v1/image_generation',
          headers: { Authorization: 'Bearer test-api-token' },
          param: {
            model: 'image-01',
            prompt: 'whale',
            aspect_ratio: '1:1',
            response_format: 'url',
            n: 1,
          },
        },
      });
    });

    it('keeps supported image options in the provider payload', () => {
      expect(
        buildDebugPayload({
          modelType: 'IMAGE_GENERATION',
          modelCode: 'image-01',
          prompt: 'blue whale',
          aspectRatio: '16:9',
          imageCount: 2,
          responseFormat: 'base64',
          promptOptimizer: false,
          seed: 42,
        }).input.param
      ).toEqual({
        model: 'image-01',
        prompt: 'blue whale',
        aspect_ratio: '16:9',
        response_format: 'base64',
        n: 2,
        prompt_optimizer: false,
        seed: 42,
      });
    });
  });

  describe('buildModelUpsertPayload', () => {
    it('removes transient image debug fields before saving model metadata', () => {
      expect(
        buildModelUpsertPayload({
          values: {
            displayName: 'MiniMax image',
            modelType: 'IMAGE_GENERATION',
            modelCode: 'image-01',
            prompt: 'whale',
            aspectRatio: '1:1',
            imageCount: 1,
            responseFormat: 'url',
            promptOptimizer: true,
            seed: 42,
          },
          type: 'edit',
          dataId: 'image-model-1',
        })
      ).toEqual({
        id: 'image-model-1',
        displayName: 'MiniMax image',
        modelType: 'IMAGE_GENERATION',
        modelCode: 'image-01',
        reasoningConfig: {
          enabled: false,
          defaultLevel: 'off',
          capability: 'unsupported',
          compatFormat: 'auto',
        },
      });
    });
  });

  describe('getModelTypeSwitchFormValues', () => {
    it.each(['LLM', 'RERANK', 'EMBEDDING'])('clears MiniMax-only values when switching to %s', (modelType) => {
      const values = getModelTypeSwitchFormValues(modelType);

      expect(values).toMatchObject({ modelType, modelCode: '' });
      expect(values.providerName).not.toBe('MINIMAX');
      expect(values.modelProtocol).not.toBe('MINIMAX_IMAGE');
      expect(values.apiEndpoint).not.toBe('https://api.minimaxi.com/v1/image_generation');
      expect(values.prompt).toBeUndefined();
      expect(values.apiToken).toBe('');
      expect(values.headers).toEqual([{ key: '', value: '' }]);
    });

    it('restores MiniMax defaults when switching back to image generation', () => {
      expect(getModelTypeSwitchFormValues('IMAGE_GENERATION')).toMatchObject({
        modelType: 'IMAGE_GENERATION',
        providerName: 'MINIMAX',
        modelProtocol: 'MINIMAX_IMAGE',
        apiEndpoint: 'https://api.minimaxi.com/v1/image_generation',
        modelCode: 'image-01',
        apiToken: '',
        headers: [{ key: '', value: '' }],
      });
    });
  });

  describe('getModelTypeTransitionFormValues', () => {
    it('preserves existing configuration between non-image model types', () => {
      expect(getModelTypeTransitionFormValues('LLM', 'RERANK')).toEqual({ modelType: 'RERANK' });
    });

    it('clears image-only configuration when leaving image generation', () => {
      expect(getModelTypeTransitionFormValues('IMAGE_GENERATION', 'LLM')).toEqual(getModelTypeSwitchFormValues('LLM'));
    });

    it('applies MiniMax defaults when entering image generation', () => {
      expect(getModelTypeTransitionFormValues('EMBEDDING', 'IMAGE_GENERATION')).toEqual(
        getModelTypeSwitchFormValues('IMAGE_GENERATION')
      );
    });
  });

  describe('hasImageGenerationPrompt', () => {
    it('accepts only a non-blank prompt in the image debug JSON contract', () => {
      expect(hasImageGenerationPrompt('{"param":{"prompt":" whale "}}')).toBe(true);
      expect(hasImageGenerationPrompt('{"param":{"prompt":"   "}}')).toBe(false);
      expect(hasImageGenerationPrompt('{"param":{}}')).toBe(false);
      expect(hasImageGenerationPrompt('not-json')).toBe(false);
    });
  });

  describe('image debug dispatch timeout', () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });

    afterEach(() => {
      jest.useRealTimers();
    });

    it('waits longer than the backend 120 second timeout before rejecting', async () => {
      const dispatch = jest.fn();
      const timeoutMs = getModelDebugDispatchTimeoutMs('IMAGE_GENERATION');
      const result = dispatchModelActionWithResult(dispatch, 'modelMgr/debugModelImageGeneration', {}, timeoutMs);
      const rejection = expect(result).rejects.toThrow('dispatch timeout');

      expect(timeoutMs).toBe(130000);
      jest.advanceTimersByTime(130000);

      await rejection;
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
    it('prefers form Authorization header over previous headers and token', () => {
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
        Authorization: 'Bearer form-token',
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
    it('prefers form X-Api-Key over previous headers and token', () => {
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
        'X-Api-Key': 'form-key',
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

  describe('getDefaultFormValues', () => {
    it('defaults modelProtocol to OpenAI', () => {
      expect(getDefaultFormValues().modelProtocol).toBe('OpenAI');
    });
  });

  describe('getDefaultLlmDebugSuffix', () => {
    it('uses anthropic messages endpoint for Anthropic protocol', () => {
      expect(getDefaultLlmDebugSuffix('Anthropic')).toBe('/v1/messages');
    });

    it('uses chat completions endpoint for OpenAI and empty values', () => {
      expect(getDefaultLlmDebugSuffix('OpenAI')).toBe('/chat/completions');
      expect(getDefaultLlmDebugSuffix(undefined)).toBe('/chat/completions');
    });
  });

  describe('getApiEndpointPlaceholder', () => {
    it('returns anthropic example endpoint for Anthropic protocol', () => {
      expect(getApiEndpointPlaceholder('Anthropic')).toBe('https://api.example.com/anthropic');
    });

    it('returns openai example endpoint for OpenAI and default', () => {
      expect(getApiEndpointPlaceholder('OpenAI')).toBe('https://api.example.com/v1');
      expect(getApiEndpointPlaceholder(undefined)).toBe('https://api.example.com/v1');
    });

    it('returns the MiniMax image generation endpoint for the image protocol', () => {
      expect(getApiEndpointPlaceholder('MINIMAX_IMAGE')).toBe('https://api.minimaxi.com/v1/image_generation');
    });
  });

  describe('buildAutoDebugRequestText', () => {
    it('serializes the MiniMax image generation input consumed by the backend debug route', () => {
      expect(
        JSON.parse(
          buildAutoDebugRequestText({
            formValues: {
              modelType: 'IMAGE_GENERATION',
              providerName: 'MINIMAX',
              modelProtocol: 'MINIMAX_IMAGE',
              apiEndpoint: 'https://api.minimaxi.com/v1/image_generation',
              apiToken: 'test-api-token',
              modelCode: 'image-01',
              prompt: 'whale',
              aspectRatio: '1:1',
              imageCount: 1,
              responseFormat: 'url',
            },
          })
        )
      ).toEqual({
        providerName: 'MINIMAX',
        modelProtocol: 'MINIMAX_IMAGE',
        url: 'https://api.minimaxi.com/v1/image_generation',
        headers: { Authorization: 'Bearer test-api-token' },
        param: {
          model: 'image-01',
          prompt: 'whale',
          aspect_ratio: '1:1',
          response_format: 'url',
          n: 1,
        },
      });
    });

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
        enable_thinking: false,
        chat_template_kwargs: { enable_thinking: false },
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

    it('uses anthropic suffix when modelProtocol is Anthropic', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            modelProtocol: 'Anthropic',
            apiEndpoint: 'https://api.anthropic.com',
            modelCode: 'claude-3-5-sonnet',
            headers: [],
          },
          defaultUserMessage: 'hello',
        })
      );

      expect(result.url).toBe('https://api.anthropic.com/v1/messages');
    });

    it('adds reasoning effort when DeepSeek thinking is enabled', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            apiEndpoint: 'https://api.deepseek.com/v1',
            modelCode: 'deepseek-reasoner',
            headers: [],
            reasoningConfig: {
              enabled: true,
              capability: 'effort',
              defaultLevel: 'max',
              compatFormat: 'deepseek',
            },
          },
          defaultUserMessage: 'hello',
        })
      );

      expect(result.reasoning_effort).toBe('max');
      expect(result.enable_thinking).toBeUndefined();
    });

    it('maps adaptive OpenAI-compatible debug effort to medium', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            apiEndpoint: 'https://api.example.com/v1',
            modelCode: 'reasoning-model',
            headers: [],
            reasoningConfig: {
              enabled: true,
              capability: 'adaptive',
              defaultLevel: 'adaptive',
              compatFormat: 'openai',
            },
          },
          defaultUserMessage: 'hello',
        })
      );

      expect(result.reasoning_effort).toBe('medium');
    });

    it('uses Anthropic adaptive thinking payload when configured', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            modelProtocol: 'Anthropic',
            apiEndpoint: 'https://api.anthropic.com',
            modelCode: 'claude-sonnet-4-6',
            headers: [],
            reasoningConfig: {
              enabled: true,
              capability: 'adaptive',
              defaultLevel: 'adaptive',
              compatFormat: 'anthropic',
            },
          },
          defaultUserMessage: 'hello',
        })
      );

      expect(result.thinking).toEqual({ type: 'adaptive', display: 'summarized' });
      expect(result.enable_thinking).toBeUndefined();
    });

    it('resets suffix when modelProtocol changes to Anthropic', () => {
      const result = JSON.parse(
        buildAutoDebugRequestText({
          formValues: {
            modelType: 'LLM',
            modelProtocol: 'Anthropic',
            apiEndpoint: 'https://api.anthropic.com',
            modelCode: 'claude-3-5-sonnet',
            headers: [],
          },
          prevText: JSON.stringify({
            url: 'https://api.anthropic.com/chat/completions',
            messages: [{ role: 'user', content: 'hello' }],
          }),
          changedKeys: ['modelProtocol'],
        })
      );

      expect(result.url).toBe('https://api.anthropic.com/v1/messages');
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

  describe('buildReasoningConfigPayload', () => {
    it('normalizes disabled reasoning config and omits UI-only effort map text', () => {
      expect(
        buildReasoningConfigPayload({
          reasoningConfig: {
            enabled: true,
            capability: 'unsupported',
            defaultLevel: 'high',
            compatFormat: 'qwen',
          },
          reasoningEffortMapText: '{"high":"high"}',
        })
      ).toEqual({
        enabled: false,
        defaultLevel: 'off',
        capability: 'unsupported',
        compatFormat: 'qwen',
      });
    });

    it('keeps supported efforts, effort map and budgets for enabled config', () => {
      expect(
        buildReasoningConfigPayload({
          reasoningConfig: {
            enabled: true,
            capability: 'adaptive',
            defaultLevel: 'adaptive',
            compatFormat: 'anthropic',
            supportedEfforts: ['low', 'adaptive', 'high'],
            budgets: { low: 2048, high: 8192, max: undefined },
          },
          reasoningEffortMapText: '{"adaptive":"high","max":"max"}',
        })
      ).toEqual({
        enabled: true,
        defaultLevel: 'adaptive',
        capability: 'adaptive',
        compatFormat: 'anthropic',
        supportedEfforts: ['low', 'adaptive', 'high'],
        effortMap: { adaptive: 'high', max: 'max' },
        budgets: { low: 2048, high: 8192 },
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
