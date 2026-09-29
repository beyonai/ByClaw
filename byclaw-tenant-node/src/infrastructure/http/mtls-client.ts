import { request as httpRequest, Agent as HttpAgent } from "node:http";
import { request as httpsRequest, Agent as HttpsAgent } from "node:https";
import { readFile } from "node:fs/promises";
import type { SecureContextOptions } from "node:tls";
import { DomainError } from "../../domain/errors.js";
import type { Config } from "../../config.js";

export async function loadTls(config: Config): Promise<SecureContextOptions | undefined> {
  if (config.transport === "http") return undefined;
  if (!config.tls) throw new Error("TLS configuration is missing");
  const [cert, key, ca] = await Promise.all(
    [config.tls.certFile, config.tls.keyFile, config.tls.caFile].map((file) => readFile(file)),
  );
  return { cert, key, ca, minVersion: "TLSv1.2" };
}
/** BE/KMS 内部 JSON 请求适配器；验证服务端证书并限制响应大小和请求时长。 */
export class MtlsClient {
  private readonly agent: HttpAgent | HttpsAgent;
  constructor(
    tls: SecureContextOptions | undefined,
    private readonly token?: string,
  ) {
    this.agent = tls
      ? new HttpsAgent({ ...tls, rejectUnauthorized: true, keepAlive: true })
      : new HttpAgent({ keepAlive: true });
  }
  async json<T>(url: string, method = "GET", body?: unknown): Promise<T> {
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise<T>((resolve, reject) => {
      const req = (url.startsWith("https:") ? httpsRequest : httpRequest)(
        url,
        {
          agent: this.agent,
          method,
          timeout: 5000,
          headers: {
            ...(bytes
              ? { "content-type": "application/json", "content-length": bytes.length }
              : {}),
            ...(this.token ? { authorization: `Bearer ${this.token}` } : {}),
          },
        },
        (res) => {
          const chunks: Buffer[] = [];
          let size = 0;
          res.on("data", (chunk: Buffer) => {
            size += chunk.length;
            if (size > 65536) {
              res.destroy();
              reject(new DomainError("UPSTREAM_RESPONSE_TOO_LARGE"));
            } else chunks.push(chunk);
          });
          res.on("error", () => reject(new DomainError("UPSTREAM_UNAVAILABLE")));
          res.on("end", () => {
            if (res.statusCode === 204) return resolve(undefined as T);
            if (res.statusCode !== 200) return reject(new DomainError("UPSTREAM_REJECTED"));
            try {
              resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")) as T);
            } catch {
              reject(new DomainError("INVALID_UPSTREAM_RESPONSE"));
            }
          });
        },
      );
      req.on("timeout", () => req.destroy());
      req.on("error", () => reject(new DomainError("UPSTREAM_UNAVAILABLE")));
      req.end(bytes);
    });
  }
  close(): void {
    this.agent.destroy();
  }
}
