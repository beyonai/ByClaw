import {
  buildAutoDebugRequestText,
  buildDebugPayload,
  buildModelUpsertPayload,
  getImageProviderTransitionFormValues,
} from '../modelFormUtils';
import {
  getImageConfigFormValues,
  getSeedreamSizeSuggestions,
  getVolcengineImagePreviews,
} from '../volcengineImageConfig';

const values = {
  modelType: 'IMAGE_GENERATION',
  providerName: 'VOLCENGINE',
  modelProtocol: 'VOLCENGINE_IMAGE',
  apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
  apiToken: 'test-token-not-a-secret',
  modelCode: 'doubao-seedream-4-0-250828',
  prompt: 'a blue whale',
};

describe('Volcengine image configuration compatibility', () => {
  it.each(['doubao-seedream-5-0-pro-260628', 'doubao-seedream-5-0-flash-260915'])(
    'uses the single-image contract and supported resolutions for %s',
    (modelCode) => {
      const { param } = buildDebugPayload({ ...values, modelCode }).input;
      expect(param).toMatchObject({ model: modelCode, prompt: 'a blue whale', size: '2K' });
      expect(param).not.toHaveProperty('stream');
      expect(param).not.toHaveProperty('sequential_image_generation');
      expect(getSeedreamSizeSuggestions(modelCode)).toEqual(['1K', '1.5K', '2K']);
    }
  );
  it.each(['VOLCENGINE_IMAGE', 'MINIMAX_IMAGE', 'UNKNOWN_IMAGE'])(
    'clearing a provider preserves connection fields for %s',
    (modelProtocol) => {
      const current = { ...values, modelProtocol, apiEndpoint: 'https://proxy.example/custom', modelCode: 'ep-custom' };
      const patch = getImageProviderTransitionFormValues(undefined, current);
      expect({ ...current, ...patch }).toMatchObject({
        modelProtocol,
        apiEndpoint: current.apiEndpoint,
        modelCode: current.modelCode,
      });
      const providers: Record<string, string> = { VOLCENGINE_IMAGE: 'VOLCENGINE', MINIMAX_IMAGE: 'MINIMAX' };
      expect(patch).toEqual({ providerName: providers[modelProtocol] });
    }
  );

  it('fills image providers only at save time without changing LLM routing or explicit providers', () => {
    const image = buildModelUpsertPayload({ values: { ...values, providerName: undefined } });
    expect(image).toMatchObject({
      providerName: 'VOLCENGINE',
      modelProtocol: values.modelProtocol,
      apiEndpoint: values.apiEndpoint,
      modelCode: values.modelCode,
    });
    expect(buildModelUpsertPayload({ values: { ...values, providerName: 'DOUBAO' } }).providerName).toBe('DOUBAO');
    const llm = buildModelUpsertPayload({
      values: { ...values, modelType: 'LLM', modelProtocol: 'OpenAI', providerName: undefined },
    });
    expect(llm.providerName).toBeUndefined();
    expect(llm.modelProtocol).toBe('OpenAI');
  });

  it('builds the Seedream single-image request without inherited MiniMax parameters', () => {
    const input = buildDebugPayload({ ...values, aspectRatio: '1:1', imageCount: 9, promptOptimizer: true }).input;
    expect(input).toEqual({
      providerName: 'VOLCENGINE',
      modelProtocol: 'VOLCENGINE_IMAGE',
      url: values.apiEndpoint,
      headers: { Authorization: 'Bearer test-token-not-a-secret' },
      param: {
        model: values.modelCode,
        prompt: 'a blue whale',
        size: '2K',
        response_format: 'url',
        watermark: true,
        sequential_image_generation: 'disabled',
        stream: false,
      },
    });
  });

  it('uses explicitly configured defaults and custom endpoint IDs in automatic debug input', () => {
    const input = JSON.parse(
      buildAutoDebugRequestText({
        formValues: {
          ...values,
          modelCode: 'ep-custom-model',
          imageGenerationConfig: { size: '2048x2048', responseFormat: 'b64_json', watermark: false },
        },
        defaultUserMessage: '',
        defaultRerankQuery: '',
        defaultRerankDocs: [],
      })
    );
    expect(input.param).toMatchObject({
      model: 'ep-custom-model',
      size: '2048x2048',
      response_format: 'b64_json',
      watermark: false,
    });
  });

  it('does not infer a new protocol from the provider name', () => {
    expect(buildDebugPayload({ ...values, modelProtocol: 'MINIMAX_IMAGE' }).input.modelProtocol).toBe('MINIMAX_IMAGE');
  });

  it('round-trips image defaults and existing extension JSON without persisting the debug prompt', () => {
    const detail = {
      ...values,
      extendParam: '{"custom_setting":{"enabled":true}}',
      imageGenerationConfig: { size: '4K', watermark: false, futureOption: { enabled: true } },
    };
    const payload = buildModelUpsertPayload({
      values: { ...values, ...getImageConfigFormValues(detail) },
      type: 'edit',
      dataId: '42',
    });
    expect(payload.extendParam).toBe(detail.extendParam);
    expect(payload.imageGenerationConfig).toEqual(detail.imageGenerationConfig);
    expect(payload).not.toHaveProperty('prompt');
  });

  it('does not add image defaults to legacy records and clears previous modal state', () => {
    const fields = getImageConfigFormValues({});
    expect(fields).toEqual({ extendParam: undefined, imageGenerationConfig: undefined });
    expect(buildModelUpsertPayload({ values: { modelType: 'LLM', ...fields } })).not.toHaveProperty(
      'imageGenerationConfig'
    );
    expect(
      buildModelUpsertPayload({
        values: { ...values, imageGenerationConfig: { size: undefined, watermark: undefined } },
      })
    ).not.toHaveProperty('imageGenerationConfig');
  });

  it.each([undefined, null])('clears missing image configuration represented by %s', (imageGenerationConfig) => {
    expect(getImageConfigFormValues({ imageGenerationConfig })).toEqual({
      extendParam: undefined,
      imageGenerationConfig: undefined,
    });
  });

  it('preserves an explicit empty configuration and copies saved image settings', () => {
    expect(getImageConfigFormValues({ imageGenerationConfig: {} }).imageGenerationConfig).toEqual({});
    const imageGenerationConfig = { size: '4K', watermark: false };
    const fields = getImageConfigFormValues({ imageGenerationConfig });
    expect(fields.imageGenerationConfig).toEqual(imageGenerationConfig);
    expect(fields.imageGenerationConfig).not.toBe(imageGenerationConfig);
  });

  it('preserves a manually entered model version and proxy URL on provider selection', () => {
    expect(
      getImageProviderTransitionFormValues('VOLCENGINE', {
        modelProtocol: 'MINIMAX_IMAGE',
        modelCode: values.modelCode,
        apiEndpoint: 'https://proxy.example/api/v3/images/generations',
      })
    ).toMatchObject({
      modelProtocol: 'VOLCENGINE_IMAGE',
      modelCode: values.modelCode,
      apiEndpoint: 'https://proxy.example/api/v3/images/generations',
    });
  });

  it('replaces previous provider presets without changing legacy provider transitions', () => {
    expect(
      getImageProviderTransitionFormValues('VOLCENGINE', {
        modelProtocol: 'MINIMAX_IMAGE',
        modelCode: 'image-01',
        apiEndpoint: 'https://api.minimaxi.com/v1/image_generation',
      })
    ).toEqual(getImageProviderTransitionFormValues('VOLCENGINE'));
    expect(getImageProviderTransitionFormValues('MINIMAX', { modelProtocol: 'OPENAI_IMAGE' })).toEqual(
      getImageProviderTransitionFormValues('MINIMAX')
    );
  });

  it('suggests resolutions by version while leaving custom model IDs available', () => {
    expect(getSeedreamSizeSuggestions(values.modelCode)).toEqual(['1K', '2K', '4K']);
    expect(getSeedreamSizeSuggestions('ep-custom-model')).toEqual(['2K']);
  });

  it('previews URL and JPEG/PNG base64 results while keeping errors out of the image list', () => {
    expect(
      getVolcengineImagePreviews(
        JSON.stringify({
          data: [
            { url: 'https://example.test/a.jpeg' },
            { b64_json: '/9j/abcd' },
            { b64_json: 'iVBORabcd' },
            { error: { code: 'Filtered' } },
            { url: 'javascript:alert(1)' },
          ],
        })
      )
    ).toEqual(['https://example.test/a.jpeg', 'data:image/jpeg;base64,/9j/abcd', 'data:image/png;base64,iVBORabcd']);
    expect(getVolcengineImagePreviews('not JSON')).toEqual([]);
    expect(getVolcengineImagePreviews('{"data":{"image_urls":["https://example.test/minimax.png"]}}')).toEqual([]);
  });
});
