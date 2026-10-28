import { createServer as httpServer, type Server } from "node:http";
import { createServer as httpsServer } from "node:https";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { MtlsClient } from "../src/infrastructure/http/mtls-client.js";
import { ensureDevelopmentCertificates } from "../src/development/certificates.js";

async function listen(server: Server): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return (server.address() as { port: number }).port;
}
async function close(server: Server) {
  if (!server.listening) return;
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}

describe("BE callback authentication", () => {
  it.each([200, 401, 403, 500])("sends Bearer and classifies HTTP %i", async (status) => {
    let authorization: string | undefined;
    const server = httpServer((req, res) => {
      authorization = req.headers.authorization;
      res.writeHead(status, { "content-type": "application/json" });
      res.end(JSON.stringify({ currentVersion: null }));
    });
    const client = new MtlsClient(undefined, "test-internal-token");
    try {
      const port = await listen(server);
      const result = client.json(`http://127.0.0.1:${port}/internal/v1/tenants/10/schema/current`);
      if (status === 200) await expect(result).resolves.toEqual({ currentVersion: null });
      else
        await expect(result).rejects.toMatchObject({
          code: [401, 403].includes(status)
            ? "UPSTREAM_AUTHENTICATION_FAILED"
            : "UPSTREAM_REJECTED",
        });
      expect(authorization).toBe("Bearer test-internal-token");
    } finally {
      client.close();
      await close(server);
    }
  });
  it("sends Bearer over HTTPS while retaining mutual certificate validation", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tenant-callback-tls-"));
    const certs = ensureDevelopmentCertificates(directory, "byclaw-be");
    const tls = {
      cert: readFileSync(certs.certFile),
      key: readFileSync(certs.keyFile),
      ca: readFileSync(certs.caFile),
    };
    let authorization: string | undefined;
    const server = httpsServer(
      { ...tls, requestCert: true, rejectUnauthorized: true },
      (req, res) => {
        authorization = req.headers.authorization;
        res.end(JSON.stringify({ currentVersion: null }));
      },
    );
    const client = new MtlsClient(tls, "test-internal-token");
    try {
      const port = await listen(server);
      await expect(
        client.json(`https://127.0.0.1:${port}/internal/v1/tenants/10/schema/current`),
      ).resolves.toEqual({ currentVersion: null });
      expect(authorization).toBe("Bearer test-internal-token");
    } finally {
      client.close();
      await close(server);
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
