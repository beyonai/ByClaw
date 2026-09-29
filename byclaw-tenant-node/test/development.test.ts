import { beforeAll, afterAll, describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { X509Certificate, createPrivateKey } from "node:crypto";
import { ensureDevelopmentCertificates } from "../src/development/certificates.js";

let directory: string;
beforeAll(() => {
  directory = mkdtempSync(join(tmpdir(), "tenant-dev-cert-"));
  ensureDevelopmentCertificates(directory, "byclaw-be");
});
afterAll(() => rmSync(directory, { recursive: true, force: true }));

describe("local development certificates", () => {
  it("generates matching keys and CA-signed localhost/client identities", () => {
    const ca = new X509Certificate(readFileSync(join(directory, "ca.crt")));
    for (const name of ["node", "be-client"]) {
      const cert = new X509Certificate(readFileSync(join(directory, `${name}.crt`)));
      expect(cert.verify(ca.publicKey)).toBe(true);
      expect(
        cert.checkPrivateKey(createPrivateKey(readFileSync(join(directory, `${name}.key`)))),
      ).toBe(true);
      expect(statSync(join(directory, `${name}.key`)).mode & 0o777).toBe(0o600);
      if (name === "node") expect(cert.checkHost("localhost")).toBe("localhost");
      else expect(cert.subject).toBe("CN=byclaw-be");
    }
  });
  it("reuses valid certificates across restarts", () => {
    const original = readFileSync(join(directory, "ca.crt"));
    ensureDevelopmentCertificates(directory, "byclaw-be");
    expect(readFileSync(join(directory, "ca.crt"))).toEqual(original);
  });
  it("rejects an invalid identity before invoking openssl", () => {
    expect(() => ensureDevelopmentCertificates(directory, "be/other")).toThrow(
      "Invalid BE_CLIENT_IDENTITY",
    );
  });
});
