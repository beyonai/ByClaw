import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from "node:crypto";
import { promisify } from "node:util";
import { execFile } from "node:child_process";
import type {
  KeyEncryptionService,
  KmsEncryptionContext,
} from "@byclaw/by-conductor";

const execFileAsync = promisify(execFile);
const KEYCHAIN_SERVICE = "byclaw-super-local-kms";

/**
 * 仅供 macOS 本地联调的 KMS adapter。
 * KEK 保存在登录钥匙串，PostgreSQL 和 .env 中仍只出现 envelope ciphertext。
 */
export async function createKeyEncryptionService(input: {
  keyId: string;
}): Promise<KeyEncryptionService> {
  if (process.env.NODE_ENV === "production") {
    throw new Error(
      "The macOS Keychain KMS adapter is for local development only",
    );
  }
  if (process.platform !== "darwin") {
    throw new Error("The local Keychain KMS adapter requires macOS");
  }
  const masterKey = await loadOrCreateMasterKey(input.keyId);
  return new MacOsKeychainKeyEncryptionService(input.keyId, masterKey);
}

/** 构造函数公开是为了在不访问真实钥匙串的情况下做加密合同单测。 */
export class MacOsKeychainKeyEncryptionService
implements KeyEncryptionService {
  readonly #keyVersion: string;
  readonly #masterKey: Buffer;

  constructor(keyId: string, masterKey: Uint8Array) {
    if (masterKey.byteLength !== 32) {
      throw new Error(
        `Local KMS master key must be 32 bytes, received: ${masterKey.byteLength}`,
      );
    }
    this.#masterKey = Buffer.from(masterKey);
    this.#keyVersion = `macos-keychain-v1:${createHash("sha256")
      .update(keyId)
      .digest("hex")
      .slice(0, 16)}`;
  }

  async generateDataKey(context: KmsEncryptionContext): Promise<{
    plaintextKey: Uint8Array;
    encryptedKey: Uint8Array;
    keyVersion: string;
  }> {
    const dataKey = randomBytes(32);
    const nonce = randomBytes(12);
    const cipher = createCipheriv("aes-256-gcm", this.#masterKey, nonce);
    cipher.setAAD(contextAad(context));
    const ciphertext = Buffer.concat([cipher.update(dataKey), cipher.final()]);
    const plaintextKey = Uint8Array.from(dataKey);
    dataKey.fill(0);
    return {
      plaintextKey,
      // 固定二进制格式：12-byte nonce + 16-byte GCM tag + ciphertext。
      encryptedKey: Uint8Array.from(
        Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]),
      ),
      keyVersion: this.#keyVersion,
    };
  }

  async decryptDataKey(input: {
    encryptedKey: Uint8Array;
    keyVersion: string;
    context: KmsEncryptionContext;
  }): Promise<Uint8Array> {
    if (input.keyVersion !== this.#keyVersion) {
      throw new Error(
        `Local KMS key version mismatch: ${input.keyVersion}`,
      );
    }
    const encrypted = Buffer.from(input.encryptedKey);
    if (encrypted.byteLength !== 60) {
      throw new Error(
        `Invalid local KMS encrypted data key length: ${encrypted.byteLength}`,
      );
    }
    const nonce = encrypted.subarray(0, 12);
    const authTag = encrypted.subarray(12, 28);
    const ciphertext = encrypted.subarray(28);
    const decipher = createDecipheriv(
      "aes-256-gcm",
      this.#masterKey,
      nonce,
    );
    decipher.setAAD(contextAad(input.context));
    decipher.setAuthTag(authTag);
    return Uint8Array.from(
      Buffer.concat([decipher.update(ciphertext), decipher.final()]),
    );
  }
}

async function loadOrCreateMasterKey(keyId: string): Promise<Buffer> {
  const existing = await readMasterKey(keyId);
  if (existing) {
    return existing;
  }

  const generated = randomBytes(32);
  const encoded = generated.toString("base64url");
  try {
    await execFileAsync("/usr/bin/security", [
      "add-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      keyId,
      "-w",
      encoded,
    ]);
    return generated;
  } catch {
    // 两个本地实例首次并发启动时，只有一个能创建；另一个读取胜出的条目。
    generated.fill(0);
    const raced = await readMasterKey(keyId);
    if (raced) {
      return raced;
    }
    throw new Error(`Unable to create local Keychain KMS key: ${keyId}`);
  }
}

async function readMasterKey(keyId: string): Promise<Buffer | undefined> {
  try {
    const { stdout } = await execFileAsync("/usr/bin/security", [
      "find-generic-password",
      "-s",
      KEYCHAIN_SERVICE,
      "-a",
      keyId,
      "-w",
    ]);
    const key = Buffer.from(stdout.trim(), "base64url");
    if (key.byteLength !== 32) {
      key.fill(0);
      throw new Error(`Invalid local Keychain KMS key: ${keyId}`);
    }
    return key;
  } catch (error) {
    if (isMissingKeychainItem(error)) {
      return undefined;
    }
    throw error;
  }
}

function isMissingKeychainItem(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: number }).code === 44
  );
}

function contextAad(context: KmsEncryptionContext): Buffer {
  return Buffer.from(
    JSON.stringify({
      aadVersion: context.aadVersion,
      runId: context.runId,
      userCode: context.userCode,
    }),
    "utf8",
  );
}
