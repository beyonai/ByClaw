import fs from "node:fs";
import { defineConfig } from "vitest/config";

/** Match esbuild `--loader:.md=text` so Vitest can import `*.md` as strings. */
function mdAsTextPlugin() {
  return {
    name: "md-as-text",
    enforce: "pre" as const,
    load(id: string) {
      const pathOnly = id.split("?", 1)[0] ?? id;
      if (!pathOnly.endsWith(".md")) {
        return null;
      }
      const text = fs.readFileSync(pathOnly, "utf8");
      return `export default ${JSON.stringify(text)};`;
    },
  };
}

export default defineConfig({
  plugins: [mdAsTextPlugin()],
});
