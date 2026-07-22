import { createPublicKey, verify as verifySignature } from "node:crypto";

export const DEFAULT_BYCLAW_LOGIN_JWT_PUBLIC_KEY =
  "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEA7wg45uUnUgPB2/uE/hpto6pSoviXi7JzS9ip6J1+CbB/bRYydF+6XnVJ5ddw5AAXSNo51beMKUEWguKg5QVzfrYPw063ojTy/36plFmTpNs7u+2fd4fvy7SrS64NRIfahp7scp6NMMXbgDrFLFXs6KJEsG7ThlA4XS4h5BS+oJ6nSnjYz6iC8PXt4wXSoyf61uWSloihQL9fO0RuAHQtHEuwuT8oHG20sg/ylSwV1/8zF4A0MdlOtbSq5UvvDWyVoOKfmEXt8V8h7ZLFAFABW2vVref5ltY0aTTqv/sM5niCa5JLB0w0beCd8FtiWljk7AF0j1W22YqtSDy2xP58IwIDAQAB";

export interface BeyondTokenClaims {
  userCode: string;
  exp?: number;
  [key: string]: unknown;
}

export interface BeyondTokenVerifierOptions {
  publicKey: string;
}

export type BeyondTokenVerifier = (input: {
  token: string;
  systemCode?: string;
}) => Promise<BeyondTokenClaims> | BeyondTokenClaims;

export class BeyondTokenAuthError extends Error {
  /** 创建可被 HTTP 层稳定识别并转换为 401 的鉴权异常。 */
  constructor(message: string) {
    super(message);
    this.name = "BeyondTokenAuthError";
  }
}

/** 创建与 ByClaw 后端 JwtTokenFilter 对齐的 Beyond-Token 验证器。 */
export function createBeyondTokenVerifier(options: BeyondTokenVerifierOptions): BeyondTokenVerifier {
  const publicKey = parsePublicKey(options.publicKey);
  return ({ token }) => {
    const [encodedHeader, encodedPayload, encodedSignature] = token.split(".");
    if (!encodedHeader || !encodedPayload || !encodedSignature) {
      throw new BeyondTokenAuthError("Invalid Beyond-Token format");
    }

    const header = parseJwtPart(encodedHeader);
    if (header.alg !== "RS256") {
      throw new BeyondTokenAuthError("Unsupported Beyond-Token algorithm");
    }

    const claims = parseJwtPart(encodedPayload);
    const verified = verifySignature(
      "RSA-SHA256",
      Buffer.from(`${encodedHeader}.${encodedPayload}`),
      publicKey,
      base64UrlToBuffer(encodedSignature),
    );
    if (!verified) {
      throw new BeyondTokenAuthError("Invalid Beyond-Token signature");
    }

    if (typeof claims.exp === "number" && claims.exp * 1_000 <= Date.now()) {
      throw new BeyondTokenAuthError("Beyond-Token expired");
    }

    const tokenUserCode = stringClaim(claims.userCode) || stringClaim(claims.user_code);
    if (!tokenUserCode) {
      throw new BeyondTokenAuthError("Beyond-Token userCode is required");
    }

    return { ...claims, userCode: tokenUserCode };
  };
}

/** 同时支持 Java 配置里的 base64 DER 公钥和 PEM 公钥。 */
function parsePublicKey(value: string) {
  const trimmed = value.trim();
  if (trimmed.includes("BEGIN PUBLIC KEY")) {
    return createPublicKey(trimmed);
  }
  return createPublicKey({
    key: Buffer.from(trimmed.replace(/\s+/g, ""), "base64"),
    format: "der",
    type: "spki",
  });
}

/** 解码并解析 JWT 的 header 或 payload，确保结果是 JSON 对象。 */
function parseJwtPart(encoded: string): Record<string, unknown> {
  try {
    const value: unknown = JSON.parse(base64UrlToBuffer(encoded).toString("utf8"));
    if (!isRecord(value)) {
      throw new Error("JWT part is not an object");
    }
    return value;
  } catch (error) {
    throw new BeyondTokenAuthError(
      error instanceof Error ? `Invalid Beyond-Token payload: ${error.message}` : "Invalid Beyond-Token payload",
    );
  }
}

/** 把 JWT 使用的 Base64URL 文本解码为二进制数据。 */
function base64UrlToBuffer(value: string): Buffer {
  return Buffer.from(value, "base64url");
}

/** 判断未知值是否为可安全读取字段的普通对象。 */
function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 读取并清理字符串类型的 JWT claim，非字符串按空值处理。 */
function stringClaim(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}
