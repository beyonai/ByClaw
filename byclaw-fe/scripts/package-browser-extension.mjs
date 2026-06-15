import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const currentDir = dirname(fileURLToPath(import.meta.url));
const projectRoot = resolve(currentDir, "..");
const extensionDir = join(projectRoot, "public/browser-extension/byclaw-browser-bridge");
const manifestPath = join(extensionDir, "manifest.json");
const outputDir = join(projectRoot, "public/download/browser-extension");

if (!existsSync(manifestPath)) {
  throw new Error(`manifest.json not found: ${manifestPath}`);
}

const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
const version = manifest.version;
const fileName = `byclaw-browser-bridge-v${version}.zip`;
const outputPath = join(outputDir, fileName);
mkdirSync(outputDir, { recursive: true });
rmSync(outputPath, { force: true });

const zipResult = spawnSync("zip", ["-qr", outputPath, "."], {
  cwd: extensionDir,
  stdio: "inherit",
});

if (zipResult.error) {
  throw zipResult.error;
}
if (zipResult.status !== 0) {
  throw new Error("Failed to package browser extension. Please make sure the `zip` command is available.");
}

const bytes = readFileSync(outputPath);
const latest = {
  name: manifest.name,
  version,
  protocolVersion: "1.1",
  fileName,
  path: `/download/browser-extension/${fileName}`,
  sha256: createHash("sha256").update(bytes).digest("hex"),
  size: statSync(outputPath).size,
  generatedAt: new Date().toISOString(),
  installGuide: "Open chrome://extensions, enable Developer mode, then unzip this package and load the unpacked directory.",
};

writeFileSync(join(outputDir, "latest.json"), `${JSON.stringify(latest, null, 2)}\n`);
console.log(`Packaged ${fileName}`);
console.log(`SHA256 ${latest.sha256}`);
