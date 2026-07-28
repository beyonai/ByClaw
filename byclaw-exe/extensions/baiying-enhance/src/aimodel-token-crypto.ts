import { createDecipheriv } from "node:crypto";

export function decryptBaiyingAimodelAuthTokenSafely(
  token: string,
  keyHex = process.env.BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX,
): string {
  const input = token.trim();
  if (!input || !keyHex || !/^[0-9a-fA-F]{32}$/.test(keyHex)) return input;
  try {
    const decipher = createDecipheriv("sm4-ecb", Buffer.from(keyHex, "hex"), null);
    const plain = Buffer.concat([
      decipher.update(Buffer.from(input, "base64")),
      decipher.final(),
    ]).toString("utf8").trim();
    return plain || input;
  } catch {
    return input;
  }
}
