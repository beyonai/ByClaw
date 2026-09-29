import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { ensureDevelopmentCertificates } from "./certificates.js";

/** pnpm dev 专用默认值；自定义证书和真实依赖配置继续由 .env 或调试器提供。 */
export function prepareDevelopmentEnvironment(env: NodeJS.ProcessEnv = process.env) {
  const root = fileURLToPath(new URL("../../", import.meta.url));
  const tls = [env.TLS_CERT_FILE, env.TLS_KEY_FILE, env.TLS_CA_FILE];
  if (tls.every((value) => !value || value.startsWith("/run/secrets/"))) {
    const certificates = ensureDevelopmentCertificates(
      join(root, ".tenant-state", "dev-tls"),
      env.BE_CLIENT_IDENTITY ?? "byclaw-be",
    );
    env.TLS_CERT_FILE = certificates.certFile;
    env.TLS_KEY_FILE = certificates.keyFile;
    env.TLS_CA_FILE = certificates.caFile;
    env.BE_CLIENT_IDENTITY ??= "byclaw-be";
  }
  if (!env.NODE_STATE_DIR || env.NODE_STATE_DIR === "/var/lib/byclaw-tenant")
    env.NODE_STATE_DIR = join(root, ".tenant-state");
  if (!env.HOST || env.HOST === "0.0.0.0") env.HOST = "127.0.0.1";
  if (!env.ADVERTISE_HOST || env.ADVERTISE_HOST.endsWith(".example.test"))
    env.ADVERTISE_HOST = "localhost";
}
