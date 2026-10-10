import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve("src");
function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory()
      ? files(join(dir, entry.name))
      : entry.name.endsWith(".ts")
        ? [join(dir, entry.name)]
        : [],
  );
}
describe("DDD dependency direction", () => {
  it("keeps domain free of external libraries and outer layers", () => {
    for (const file of files(join(root, "domain"))) {
      const imports = [...readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)].map(
        (m) => m[1]!,
      );
      for (const dependency of imports) {
        expect(dependency.startsWith("."), `${file}: ${dependency}`).toBe(true);
        expect(
          relative(root, resolve(dirname(file), dependency)).startsWith("domain/"),
          `${file}: ${dependency}`,
        ).toBe(true);
      }
    }
  });
  it("keeps application independent of ORM, HTTP and Redis adapters", () => {
    for (const file of files(join(root, "application"))) {
      for (const match of readFileSync(file, "utf8").matchAll(/from\s+["']([^"']+)["']/g)) {
        const dependency = match[1]!;
        expect(dependency.startsWith("."), `${file}: ${dependency}`).toBe(true);
        const target = relative(root, resolve(dirname(file), dependency));
        expect(
          target.startsWith("application/") || target.startsWith("domain/"),
          `${file}: ${dependency}`,
        ).toBe(true);
      }
    }
  });
});
