import {
  catalogProtocolOptions,
  getProviderLogo,
  getCatalogProviderValues,
  providerParamGroup,
  registerProviderCatalog,
} from '../mediaProviderCatalog';

describe('plugin provider system parameters', () => {
  it('loads ASR protocol and form values from system dictionary metadata', () => {
    registerProviderCatalog('ASR', [
      {
        paramValue: 'VOLCENGINE',
        paramDesc: JSON.stringify({
          adapter: 'byclaw-asr',
          modelProtocol: 'VOLCENGINE_ASR_FLASH',
          apiEndpoint: 'https://openspeech.bytedance.com/api/v3/auc/bigmodel/recognize/flash',
          modelCode: 'bigmodel',
          options: { resourceId: 'volc.bigasr.auc_turbo' },
        }),
      },
    ]);
    expect(providerParamGroup('ASR')).toBe('SYSTEM_MODEL_ASR_PROVIDER_NAME');
    expect(getCatalogProviderValues('ASR', 'VOLCENGINE')).toMatchObject({
      modelProtocol: 'VOLCENGINE_ASR_FLASH',
      modelCode: 'bigmodel',
    });
    expect(catalogProtocolOptions('ASR')).toEqual([{ label: 'VOLCENGINE_ASR_FLASH', value: 'VOLCENGINE_ASR_FLASH' }]);
  });
  it('replaces removed providers and tolerates legacy plain descriptions', () => {
    registerProviderCatalog('ASR', [{ paramValue: 'LEGACY', paramDesc: 'legacy' }]);
    expect(getCatalogProviderValues('ASR', 'VOLCENGINE')).toBeUndefined();
    expect(getCatalogProviderValues('ASR', 'LEGACY')).toBeUndefined();
  });
});

describe('catalog extensions and deployed asset paths', () => {
  afterEach(() => {
    delete window.publicPath;
  });

  it('uses a dedicated group for future model types while preserving legacy shared groups', () => {
    expect(providerParamGroup(' video_generation ')).toBe('SYSTEM_MODEL_VIDEO_GENERATION_PROVIDER_NAME');
    expect(providerParamGroup('embedding')).toBe('SYSTEM_MODEL_PROVIDER_NAME');
  });

  it('ignores invalid metadata fields and clears provider-specific options on switch', () => {
    registerProviderCatalog('TTS', [{ paramValue: 'BAD', paramDesc: '{"modelProtocol":{},"options":[]}' }]);
    expect(getCatalogProviderValues('TTS', 'BAD')).toBeUndefined();
    registerProviderCatalog('TTS', [{ paramValue: 'OPENAI', paramDesc: '{"modelProtocol":"OPENAI_TTS"}' }]);
    expect(getCatalogProviderValues('tts', 'openai')).toMatchObject({ modelProtocol: 'OPENAI_TTS', extendParam: '' });
  });

  it('honors catalog logos under the actual ByClaw public path', () => {
    window.publicPath = '/byclaw';
    registerProviderCatalog('ASR', [
      { paramValue: 'VOLCENGINE', paramDesc: '{"logo":"/model-providers/volcengine.svg"}' },
    ]);
    expect(getProviderLogo('ASR', 'VOLCENGINE')).toBe('/byclaw/model-providers/volcengine.svg');
  });
});
