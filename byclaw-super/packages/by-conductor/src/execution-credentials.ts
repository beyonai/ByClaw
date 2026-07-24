import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";

/** PostgreSQL 中允许保存的 envelope encryption 结果，不含任何明文凭证。 */
export interface EncryptedExecutionCredential {
  runId: string;
  ciphertext: Uint8Array;
  encryptedDataKey: Uint8Array;
  keyVersion: string;
  nonce: Uint8Array;
  authTag: Uint8Array;
  aadVersion: number;
  expiresAt: number;
  createdAt: number;
}

export interface KmsEncryptionContext {
  runId: string;
  userCode: string;
  aadVersion: number;
}

/**
 * 云厂商 KMS 适配边界。生产实现必须让 KMS 生成并包裹 DEK；
 * by-conductor 永远不持有或配置 KMS 主密钥。
 */
export interface KeyEncryptionService {
  generateDataKey(context: KmsEncryptionContext): Promise<{
    plaintextKey: Uint8Array;
    encryptedKey: Uint8Array;
    keyVersion: string;
  }>;
  decryptDataKey(input: {
    encryptedKey: Uint8Array;
    keyVersion: string;
    context: KmsEncryptionContext;
  }): Promise<Uint8Array>;
}

export class ExecutionCredentialExpiredError extends Error {
  constructor(runId: string) {
    super(`Execution credential expired: ${runId}`);
    this.name = "ExecutionCredentialExpiredError";
  }
}

/** 用 KMS 包裹 DEK，并用 AES-256-GCM 加密短期 Beyond-Token。 */
export class EnvelopeExecutionCredentialCipher {
  static readonly AAD_VERSION = 1;

  constructor(
    private readonly kms: KeyEncryptionService,
    private readonly now: () => number = Date.now,
  ) {}

  /** 加密凭证；调用结束前会主动清零 DEK 和明文 Buffer。 */
  async seal(input: {
    runId: string;
    userCode: string;
    secret: string;
    expiresAt: number;
  }): Promise<EncryptedExecutionCredential> {
    if (input.expiresAt <= this.now()) {
      throw new ExecutionCredentialExpiredError(input.runId);
    }
    const context = credentialContext(input.runId, input.userCode);
    const generated = await this.kms.generateDataKey(context);
    const key = Buffer.from(generated.plaintextKey);
    const plaintext = Buffer.from(input.secret, "utf8");
    try {
      if (key.byteLength !== 32) {
        throw new Error(`KMS data key must be 32 bytes, received: ${key.byteLength}`);
      }
      const nonce = randomBytes(12);
      const cipher = createCipheriv("aes-256-gcm", key, nonce);
      cipher.setAAD(aad(context));
      const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
      return {
        runId: input.runId,
        ciphertext,
        encryptedDataKey: Buffer.from(generated.encryptedKey),
        keyVersion: generated.keyVersion,
        nonce,
        authTag: cipher.getAuthTag(),
        aadVersion: context.aadVersion,
        expiresAt: input.expiresAt,
        createdAt: this.now(),
      };
    } finally {
      key.fill(0);
      plaintext.fill(0);
      if (generated.plaintextKey instanceof Uint8Array) {
        generated.plaintextKey.fill(0);
      }
    }
  }

  /** 只有存储层已验证 lease/fencing 后才应调用；返回值用完后由调用方尽快丢弃。 */
  async open(
    credential: EncryptedExecutionCredential,
    userCode: string,
  ): Promise<string> {
    if (credential.expiresAt <= this.now()) {
      throw new ExecutionCredentialExpiredError(credential.runId);
    }
    if (credential.aadVersion !== EnvelopeExecutionCredentialCipher.AAD_VERSION) {
      throw new Error(`Unsupported execution credential AAD version: ${credential.aadVersion}`);
    }
    const context = credentialContext(credential.runId, userCode);
    const rawKey = await this.kms.decryptDataKey({
      encryptedKey: credential.encryptedDataKey,
      keyVersion: credential.keyVersion,
      context,
    });
    const key = Buffer.from(rawKey);
    try {
      if (key.byteLength !== 32) {
        throw new Error(`KMS data key must be 32 bytes, received: ${key.byteLength}`);
      }
      const decipher = createDecipheriv(
        "aes-256-gcm",
        key,
        credential.nonce,
      );
      decipher.setAAD(aad(context));
      decipher.setAuthTag(Buffer.from(credential.authTag));
      const plaintext = Buffer.concat([
        decipher.update(credential.ciphertext),
        decipher.final(),
      ]);
      try {
        // JavaScript string 无法原地清零；至少把承载解密结果的可变 Buffer 立即擦除。
        return plaintext.toString("utf8");
      } finally {
        plaintext.fill(0);
      }
    } finally {
      key.fill(0);
      if (rawKey instanceof Uint8Array) {
        rawKey.fill(0);
      }
    }
  }
}

function credentialContext(runId: string, userCode: string): KmsEncryptionContext {
  return {
    runId,
    userCode,
    aadVersion: EnvelopeExecutionCredentialCipher.AAD_VERSION,
  };
}

/** AAD 使用带长度的 JSON，避免简单字符串拼接产生歧义。 */
function aad(context: KmsEncryptionContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      aadVersion: context.aadVersion,
      runId: context.runId,
      userCode: context.userCode,
    }),
    "utf8",
  );
}
