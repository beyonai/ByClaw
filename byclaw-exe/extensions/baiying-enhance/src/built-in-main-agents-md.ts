import { promises as fs } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Source of truth: `templates/main-agents.md`.
 *
 * Keep this as a runtime file read instead of `import "../templates/main-agents.md"` so
 * OpenClaw can load the plugin directly from TypeScript while debugging.
 */
export async function loadBuiltinMainAgentsMd(): Promise<string> {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const candidates = [
    path.resolve(here, "..", "templates", "main-agents.md"),
    path.resolve(here, "..", "..", "templates", "main-agents.md"),
  ];
  for (const candidate of candidates) {
    try {
      return await fs.readFile(candidate, "utf8");
    } catch {
      // Try the next layout: source runs from src/, bundled runs from dist/.
    }
  }
  return "";
}
