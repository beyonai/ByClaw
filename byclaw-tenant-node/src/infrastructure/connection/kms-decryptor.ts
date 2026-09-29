import { DomainError } from "../../domain/errors.js";
import type { TenantSnapshot } from "../../domain/tenant.js";
import type { MtlsClient } from "../http/mtls-client.js";

export interface CredentialEnvelope {
  alg: "SM4-GCM";
  keyId: string;
  nonce: string;
  ciphertext: string;
  tag: string;
}
function base64(value: unknown, length?: number): Buffer {
  if (typeof value !== "string" || !value || value.length > 2048)
    throw new DomainError("INVALID_CREDENTIAL_ENVELOPE");
  const bytes = Buffer.from(value, "base64");
  if (bytes.toString("base64") !== value || (length !== undefined && bytes.length !== length))
    throw new DomainError("INVALID_CREDENTIAL_ENVELOPE");
  return bytes;
}
export function credentialEnvelope(json: string): CredentialEnvelope {
  let value: CredentialEnvelope;
  try {
    value = JSON.parse(json);
  } catch {
    throw new DomainError("INVALID_CREDENTIAL_ENVELOPE");
  }
  if (
    value?.alg !== "SM4-GCM" ||
    typeof value.keyId !== "string" ||
    !value.keyId ||
    value.keyId.length > 256
  )
    throw new DomainError("INVALID_CREDENTIAL_ENVELOPE");
  base64(value.nonce, 12);
  base64(value.tag, 16);
  base64(value.ciphertext);
  return value;
}
/** The workload-authenticated KMS decrypts SM4-GCM; no master key enters Node. */
export async function decryptPassword(
  client: MtlsClient,
  url: string,
  snapshot: TenantSnapshot,
): Promise<string> {
  const envelope = credentialEnvelope(snapshot.passwordEnvelope);
  const aad = Buffer.from(
    `byclaw:tenant-db:v1:${snapshot.enterpriseId}:${snapshot.database}`,
  ).toString("base64");
  const response = await client.json<{ plaintext: string }>(url, "POST", {
    enterpriseId: snapshot.enterpriseId,
    databaseName: snapshot.database,
    aad,
    envelope,
  });
  const bytes = base64(response?.plaintext);
  if (bytes.length > 512) throw new DomainError("INVALID_KMS_RESPONSE");
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new DomainError("INVALID_KMS_RESPONSE");
  }
}
