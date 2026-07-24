import { randomBytes, randomUUID } from "node:crypto";
import { describe, expect, it } from "vitest";
import { MacOsKeychainKeyEncryptionService } from "../security/keychain-kms-adapter.js";

describe("macOS 本地 Keychain KMS adapter", () => {
  it("用 encryption context 包裹 DEK，并拒绝跨用户解密", async () => {
    const kms = new MacOsKeychainKeyEncryptionService(
      "local-test-key",
      randomBytes(32),
    );
    const context = {
      runId: randomUUID(),
      userCode: "user-a",
      aadVersion: 1,
    };
    const generated = await kms.generateDataKey(context);

    expect(generated.plaintextKey).toHaveLength(32);
    expect(generated.encryptedKey).toHaveLength(60);
    await expect(
      kms.decryptDataKey({
        encryptedKey: generated.encryptedKey,
        keyVersion: generated.keyVersion,
        context,
      }),
    ).resolves.toEqual(generated.plaintextKey);
    await expect(
      kms.decryptDataKey({
        encryptedKey: generated.encryptedKey,
        keyVersion: generated.keyVersion,
        context: { ...context, userCode: "user-b" },
      }),
    ).rejects.toThrow();
  });
});
