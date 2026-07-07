import { createDecipheriv } from "node:crypto";

export const BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX_ENV =
    "BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX";

function nonEmptyString(value: unknown): string {
    return typeof value === "string" && value.trim() ? value.trim() : "";
}

export function resolveBaiyingAimodelAuthTokenSm4KeyHex(
    value = process.env[BAIYING_AIMODEL_AUTH_TOKEN_SM4_KEY_HEX_ENV],
): string | null {
    const candidate = nonEmptyString(value);
    return /^[0-9a-fA-F]{32}$/.test(candidate) ? candidate : null;
}

export function decryptBaiyingAimodelAuthTokenSafely(
    token: string,
    keyHex = resolveBaiyingAimodelAuthTokenSm4KeyHex(),
): string {
    const input = nonEmptyString(token);
    if (!input) {
        return "";
    }
    if (!keyHex) {
        return input;
    }
    try {
        const key = Buffer.from(keyHex, "hex");
        const cipherText = Buffer.from(input, "base64");
        if (cipherText.length === 0 || cipherText.length % 16 !== 0) {
            return input;
        }
        const decipher = createDecipheriv("sm4-ecb", key, null);
        const plainText = Buffer.concat([decipher.update(cipherText), decipher.final()]).toString("utf8");
        return nonEmptyString(plainText) || input;
    } catch {
        return input;
    }
}
