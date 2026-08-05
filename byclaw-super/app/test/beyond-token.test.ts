import { generateKeyPairSync, sign } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  BeyondTokenAuthError,
  createBeyondTokenVerifier,
} from "../auth/beyond-token.js";

const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
const publicKeyDer = publicKey.export({ format: "der", type: "spki" }).toString("base64");

describe("Beyond-Token verifier", () => {
  it("verifies an RS256 token and returns its claims", async () => {
    const verify = createBeyondTokenVerifier({
      publicKey: publicKeyDer,
    });
    const token = createToken({ userCode: "user-1", exp: futureTimestamp() });

    await expect(Promise.resolve().then(() => verify({ token }))).resolves.toMatchObject({
      userCode: "user-1",
    });
  });

  it("rejects a token without userCode", async () => {
    const verify = createBeyondTokenVerifier({
      publicKey: publicKeyDer,
    });
    const token = createToken({ exp: futureTimestamp() });

    await expect(
      Promise.resolve().then(() => verify({ token })),
    ).rejects.toBeInstanceOf(BeyondTokenAuthError);
  });

  it("rejects expired or tampered tokens", async () => {
    const verify = createBeyondTokenVerifier({
      publicKey: publicKeyDer,
    });
    const expired = createToken({ userCode: "user-1", exp: 1 });
    const valid = createToken({ userCode: "user-1", exp: futureTimestamp() });
    const [header, _payload, signature] = valid.split(".");
    const tampered = `${header}.${encode({ userCode: "user-1", exp: futureTimestamp(), tampered: true })}.${signature}`;

    await expect(
      Promise.resolve().then(() => verify({ token: expired })),
    ).rejects.toThrow("expired");
    await expect(
      Promise.resolve().then(() => verify({ token: tampered })),
    ).rejects.toThrow("signature");
  });
});

/** 创建测试用 RS256 JWT，载荷与 ByClaw LoginInfo token 的关键字段一致。 */
function createToken(claims: Record<string, unknown>): string {
  const encodedHeader = encode({ alg: "RS256", typ: "JWT" });
  const encodedPayload = encode(claims);
  const signingInput = `${encodedHeader}.${encodedPayload}`;
  const signature = sign("RSA-SHA256", Buffer.from(signingInput), privateKey).toString("base64url");
  return `${signingInput}.${signature}`;
}

/** 将 JWT header 或 payload 编码为 Base64URL。 */
function encode(value: Record<string, unknown>): string {
  return Buffer.from(JSON.stringify(value)).toString("base64url");
}

/** 返回一分钟后的秒级 Unix 时间戳。 */
function futureTimestamp(): number {
  return Math.floor(Date.now() / 1_000) + 60;
}
