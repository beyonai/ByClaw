import { X509Certificate } from "node:crypto";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

/** 本地专用 CA 和服务/BE 客户端证书；不安装到系统信任库，不用于生产部署。 */
export function ensureDevelopmentCertificates(directory: string, clientIdentity: string) {
  if (!/^[A-Za-z0-9_.-]{1,64}$/.test(clientIdentity)) throw new Error("Invalid BE_CLIENT_IDENTITY");
  const path = (name: string) => join(directory, name);
  const files = ["ca.crt", "ca.key", "node.crt", "node.key", "be-client.crt", "be-client.key"];
  const reusable =
    files.every((file) => existsSync(path(file))) &&
    ["node", "be-client"].every((name) => {
      try {
        const cert = new X509Certificate(readFileSync(path(`${name}.crt`)));
        return (
          Date.parse(cert.validTo) > Date.now() + 86400000 &&
          (name !== "be-client" || cert.subject === `CN=${clientIdentity}`)
        );
      } catch {
        return false;
      }
    });
  if (!reusable) {
    mkdirSync(directory, { recursive: true, mode: 0o700 });
    const openssl = (...args: string[]) => {
      const result = spawnSync("openssl", args, { stdio: "pipe" });
      if (result.error || result.status !== 0)
        throw new Error(
          "Cannot generate development certificates; install openssl and check directory permissions",
        );
    };
    openssl(
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-nodes",
      "-days",
      "365",
      "-keyout",
      path("ca.key"),
      "-out",
      path("ca.crt"),
      "-subj",
      "/CN=ByClaw Local Development CA",
      "-addext",
      "basicConstraints=critical,CA:TRUE",
      "-addext",
      "keyUsage=critical,keyCertSign,cRLSign",
    );
    for (const [name, cn, serial] of [
      ["node", "localhost", "2"],
      ["be-client", clientIdentity, "3"],
    ]) {
      const ext = path(`${name}.ext`),
        csr = path(`${name}.csr`);
      try {
        writeFileSync(
          ext,
          "basicConstraints=critical,CA:FALSE\nkeyUsage=critical,digitalSignature,keyEncipherment\nextendedKeyUsage=" +
            (name === "node"
              ? "serverAuth,clientAuth\nsubjectAltName=DNS:localhost,IP:127.0.0.1,IP:::1\n"
              : "clientAuth\n"),
        );
        openssl(
          "req",
          "-new",
          "-newkey",
          "rsa:2048",
          "-nodes",
          "-keyout",
          path(`${name}.key`),
          "-out",
          csr,
          "-subj",
          `/CN=${cn}`,
        );
        openssl(
          "x509",
          "-req",
          "-in",
          csr,
          "-CA",
          path("ca.crt"),
          "-CAkey",
          path("ca.key"),
          "-set_serial",
          serial!,
          "-days",
          "30",
          "-out",
          path(`${name}.crt`),
          "-extfile",
          ext,
        );
      } finally {
        rmSync(ext, { force: true });
        rmSync(csr, { force: true });
      }
    }
  }
  for (const name of ["ca.key", "node.key", "be-client.key"]) chmodSync(path(name), 0o600);
  return { certFile: path("node.crt"), keyFile: path("node.key"), caFile: path("ca.crt") };
}
