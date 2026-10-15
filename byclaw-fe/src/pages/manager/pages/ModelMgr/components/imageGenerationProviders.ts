export type ImageGenerationProviderDefinition = {
  providerName: string;
  label: string;
  modelProtocol: string;
  apiEndpoint: string;
  modelCode: string;
  aliases?: readonly string[];
  managerDebug: 'minimax' | 'volcengine' | 'openclaw';
};

export const IMAGE_GENERATION_PROVIDERS: readonly ImageGenerationProviderDefinition[] = [
  {
    providerName: 'COMFYUI',
    label: 'ComfyUI',
    modelProtocol: 'COMFY_IMAGE',
    apiEndpoint: 'http://127.0.0.1:8188',
    modelCode: 'workflow',
    aliases: ['COMFY'],
    managerDebug: 'openclaw',
  },
  {
    providerName: 'DEEPINFRA',
    label: 'DeepInfra',
    modelProtocol: 'DEEPINFRA_IMAGE',
    apiEndpoint: 'https://api.deepinfra.com/v1/openai',
    modelCode: 'black-forest-labs/FLUX-1-schnell',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'FAL',
    label: 'fal',
    modelProtocol: 'FAL_IMAGE',
    apiEndpoint: 'https://fal.run',
    modelCode: 'fal-ai/flux/dev',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'GOOGLE',
    label: 'Google',
    modelProtocol: 'GOOGLE_IMAGE',
    apiEndpoint: 'https://generativelanguage.googleapis.com/v1beta',
    modelCode: 'gemini-3.1-flash-image-preview',
    aliases: ['GEMINI'],
    managerDebug: 'openclaw',
  },
  {
    providerName: 'LITELLM',
    label: 'LiteLLM',
    modelProtocol: 'LITELLM_IMAGE',
    apiEndpoint: 'http://localhost:4000',
    modelCode: 'gpt-image-2',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'MICROSOFT_FOUNDRY',
    label: 'Microsoft Foundry',
    modelProtocol: 'MICROSOFT_FOUNDRY_IMAGE',
    apiEndpoint: '',
    modelCode: '',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'MINIMAX',
    label: 'MiniMax',
    modelProtocol: 'MINIMAX_IMAGE',
    apiEndpoint: 'https://api.minimaxi.com/v1/image_generation',
    modelCode: 'image-01',
    managerDebug: 'minimax',
  },
  {
    providerName: 'OPENAI',
    label: 'OpenAI',
    modelProtocol: 'OPENAI_IMAGE',
    apiEndpoint: 'https://api.openai.com/v1',
    modelCode: 'gpt-image-2',
    aliases: ['CHATGPT'],
    managerDebug: 'openclaw',
  },
  {
    providerName: 'OPENROUTER',
    label: 'OpenRouter',
    modelProtocol: 'OPENROUTER_IMAGE',
    apiEndpoint: 'https://openrouter.ai/api/v1',
    modelCode: 'google/gemini-3.1-flash-image-preview',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'VYDRA',
    label: 'Vydra',
    modelProtocol: 'VYDRA_IMAGE',
    apiEndpoint: 'https://www.vydra.ai/api/v1',
    modelCode: 'grok-imagine',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'XAI',
    label: 'xAI',
    modelProtocol: 'XAI_IMAGE',
    apiEndpoint: 'https://api.x.ai/v1',
    modelCode: 'grok-imagine-image',
    managerDebug: 'openclaw',
  },
  {
    providerName: 'VOLCENGINE',
    label: 'Volcengine Ark',
    modelProtocol: 'VOLCENGINE_IMAGE',
    apiEndpoint: 'https://ark.cn-beijing.volces.com/api/v3/images/generations',
    modelCode: 'doubao-seedream-5-0-260128',
    aliases: ['DOUBAO', 'ARK'],
    managerDebug: 'volcengine',
  },
];

export const IMAGE_GENERATION_PROVIDER_OPTIONS = IMAGE_GENERATION_PROVIDERS.map((provider) => ({
  label: provider.label,
  value: provider.providerName,
}));

function normalizeProviderName(value?: any) {
  return `${value ?? ''}`.trim().toUpperCase().replaceAll('-', '_').replaceAll(' ', '_');
}

export function getImageGenerationProvider(value?: any): ImageGenerationProviderDefinition | undefined {
  const normalized = normalizeProviderName(value);
  if (!normalized) return undefined;
  return IMAGE_GENERATION_PROVIDERS.find(
    (provider) =>
      provider.providerName === normalized || provider.aliases?.some((alias) => normalizeProviderName(alias) === normalized)
  );
}

export function getImageGenerationProviderByProtocol(protocol?: any): ImageGenerationProviderDefinition | undefined {
  const normalized = normalizeProviderName(protocol);
  return IMAGE_GENERATION_PROVIDERS.find((provider) => normalizeProviderName(provider.modelProtocol) === normalized);
}

/** 只为缺失值补全已知图片协议的提供商，保留已有名称和别名，不猜测通用协议或自定义地址。 */
export function resolveImageGenerationProviderName(providerName?: string, modelProtocol?: string) {
  if (providerName?.trim()) return providerName;
  return getImageGenerationProviderByProtocol(modelProtocol)?.providerName;
}

export function getImageProviderFormValues(providerName?: any) {
  const provider = getImageGenerationProvider(providerName) || getImageGenerationProvider('MINIMAX')!;
  return {
    providerName: provider.providerName,
    modelProtocol: provider.modelProtocol,
    apiEndpoint: provider.apiEndpoint,
    modelCode: provider.modelCode,
  };
}

export function supportsManagerImageDebug(providerName?: any, modelProtocol?: any) {
  const resolvedProvider = resolveImageGenerationProviderName(providerName, modelProtocol);

  // 火山调试必须显式选中图片协议，不根据名称猜测或改写旧模型的协议。
  if (modelProtocol === 'VOLCENGINE_IMAGE') {
    return getImageGenerationProvider(resolvedProvider)?.providerName === 'VOLCENGINE';
  }
  return (
    getImageGenerationProvider(resolvedProvider || (!modelProtocol ? 'MINIMAX' : undefined))?.managerDebug === 'minimax'
  );
}
