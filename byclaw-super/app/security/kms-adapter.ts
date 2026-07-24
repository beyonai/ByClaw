import type { KeyEncryptionService } from "@byclaw/by-conductor";

export interface KmsAdapterConfig {
  /** 已安装模块名，例如公司内部的 @company/byclaw-kms-adapter。 */
  adapterModule: string;
  /** KMS customer-managed key 标识；adapter 自行解释 ARN/资源 ID。 */
  keyId: string;
}

type KmsAdapterModule = {
  createKeyEncryptionService?: (input: {
    keyId: string;
  }) => Promise<KeyEncryptionService> | KeyEncryptionService;
};

/**
 * 动态装载云厂商/公司 KMS adapter。
 * 核心仓库不绑定 AWS、阿里云或华为云 SDK，也绝不回退到进程内静态主密钥。
 */
export async function loadKeyEncryptionService(
  config: KmsAdapterConfig,
): Promise<KeyEncryptionService> {
  const imported = (await import(config.adapterModule)) as KmsAdapterModule;
  if (typeof imported.createKeyEncryptionService !== "function") {
    throw new Error(
      `KMS adapter must export createKeyEncryptionService(): ${config.adapterModule}`,
    );
  }
  const service = await imported.createKeyEncryptionService({
    keyId: config.keyId,
  });
  if (
    !service ||
    typeof service.generateDataKey !== "function" ||
    typeof service.decryptDataKey !== "function"
  ) {
    throw new Error(`Invalid KeyEncryptionService from: ${config.adapterModule}`);
  }
  return service;
}
