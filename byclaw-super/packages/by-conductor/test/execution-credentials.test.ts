import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  EnvelopeExecutionCredentialCipher,
  ExecutionCredentialExpiredError,
  type KeyEncryptionService,
  type KmsEncryptionContext,
} from "../src/execution-credentials.js";

describe("KMS envelope execution credential", () => {
  it("round-trips with authenticated run/user context and never stores plaintext", async () => {
    const kms = new FakeKms();
    const cipher = new EnvelopeExecutionCredentialCipher(kms, () => 1_000);
    const runId = randomUUID();
    const credential = await cipher.seal({
      runId,
      userCode: "user-a",
      secret: "beyond-secret-token",
      expiresAt: 2_000,
    });

    expect(JSON.stringify(credential)).not.toContain("beyond-secret-token");
    await expect(cipher.open(credential, "user-a")).resolves.toBe(
      "beyond-secret-token",
    );
    await expect(cipher.open(credential, "user-b")).rejects.toThrow(
      "KMS encryption context mismatch",
    );
  });

  it("rejects tampering and expired credentials", async () => {
    let now = 1_000;
    const cipher = new EnvelopeExecutionCredentialCipher(
      new FakeKms(),
      () => now,
    );
    const credential = await cipher.seal({
      runId: randomUUID(),
      userCode: "user-a",
      secret: "token",
      expiresAt: 2_000,
    });
    const tampered = structuredClone(credential);
    tampered.ciphertext[0] = (tampered.ciphertext[0] ?? 0) ^ 1;

    await expect(cipher.open(tampered, "user-a")).rejects.toThrow();
    now = 2_001;
    await expect(cipher.open(credential, "user-a")).rejects.toBeInstanceOf(
      ExecutionCredentialExpiredError,
    );
  });

  it("KMS key rotation 后仍按密文记录的旧 keyVersion 解密", async () => {
    const kms = new FakeKms();
    const cipher = new EnvelopeExecutionCredentialCipher(kms, () => 1_000);
    const oldCredential = await cipher.seal({
      runId: randomUUID(),
      userCode: "user-a",
      secret: "old-token",
      expiresAt: 2_000,
    });
    kms.rotate();
    const newCredential = await cipher.seal({
      runId: randomUUID(),
      userCode: "user-a",
      secret: "new-token",
      expiresAt: 2_000,
    });

    expect(oldCredential.keyVersion).toBe("test-key-v1");
    expect(newCredential.keyVersion).toBe("test-key-v2");
    await expect(cipher.open(oldCredential, "user-a")).resolves.toBe("old-token");
    await expect(cipher.open(newCredential, "user-a")).resolves.toBe("new-token");
  });
});

/** 模拟 KMS 的 encryption context 约束；只用于单元测试。 */
class FakeKms implements KeyEncryptionService {
  #currentVersion = "test-key-v1";
  readonly #keys = new Map<
    string,
    { key: Uint8Array; context: string; version: string }
  >();

  async generateDataKey(context: KmsEncryptionContext) {
    const id = randomUUID();
    const key = randomBytes(32);
    const encryptedKey = Buffer.from(id, "utf8");
    this.#keys.set(id, {
      key: Uint8Array.from(key),
      context: JSON.stringify(context),
      version: this.#currentVersion,
    });
    return {
      plaintextKey: Uint8Array.from(key),
      encryptedKey,
      keyVersion: this.#currentVersion,
    };
  }

  async decryptDataKey(input: {
    encryptedKey: Uint8Array;
    keyVersion: string;
    context: KmsEncryptionContext;
  }): Promise<Uint8Array> {
    const stored = this.#keys.get(Buffer.from(input.encryptedKey).toString("utf8"));
    if (
      !stored ||
      stored.version !== input.keyVersion ||
      stored.context !== JSON.stringify(input.context)
    ) {
      throw new Error("KMS encryption context mismatch");
    }
    return Uint8Array.from(stored.key);
  }

  rotate(): void {
    this.#currentVersion = "test-key-v2";
  }
}
