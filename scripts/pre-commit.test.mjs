import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
    chmodSync,
    copyFileSync,
    mkdirSync,
    mkdtempSync,
    readFileSync,
    rmSync,
    writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";

test("partial commits preserve the lint-staged index and isolate Git variables from tests", () => {
    const root = mkdtempSync(join(tmpdir(), "byclaw-hook-regression-"));
    const env = { ...process.env };
    // Test repositories must not inherit the caller's commit index.
    for (const name of execFileSync("git", ["rev-parse", "--local-env-vars"], {
        encoding: "utf8",
    })
        .trim()
        .split("\n")) {
        delete env[name];
    }
    const git = (...args) =>
        execFileSync("git", args, { cwd: root, env, encoding: "utf8" }).trim();
    const put = (file, content) => {
        mkdirSync(dirname(join(root, file)), { recursive: true });
        writeFileSync(join(root, file), content);
    };
    try {
        git("init", "-q");
        git("config", "user.name", "Hook regression");
        git("config", "user.email", "hook@example.invalid");
        git("config", "core.hooksPath", ".git/hooks");
        put("byclaw-fe/a.txt", "base\n");
        put("byclaw-fe/b.txt", "base\n");
        git("add", ".");
        git("commit", "-qm", "base");
        put("byclaw-fe/a.txt", "selected\n");
        put("byclaw-fe/b.txt", "unrelated\n");
        git("add", ".");
        put("bin/npx", "#!/bin/sh\ngit stash create >/dev/null\n");
        put(
            "bin/pnpm",
            `#!/bin/sh
set -e
mkdir -p "$HOOK_NESTED_REPO"
git -C "$HOOK_NESTED_REPO" init -q
printf 'nested\\n' > "$HOOK_NESTED_REPO/nested.txt"
git -C "$HOOK_NESTED_REPO" add nested.txt
git -C "$HOOK_NESTED_REPO" diff --cached --name-only > "$HOOK_NESTED_RESULT"
`
        );
        for (const file of ["bin/npx", "bin/pnpm"])
            chmodSync(join(root, file), 0o755);
        env.PATH = `${join(root, "bin")}:${env.PATH}`;
        env.HOOK_NESTED_REPO = join(root, "nested");
        env.HOOK_NESTED_RESULT = join(root, "nested-result.txt");
        copyFileSync(
            new URL("../.husky/pre-commit", import.meta.url),
            join(root, ".git/hooks/pre-commit")
        );
        chmodSync(join(root, ".git/hooks/pre-commit"), 0o755);
        const result = spawnSync(
            "git",
            ["commit", "--only", "-m", "selected", "--", "byclaw-fe/a.txt"],
            {
                cwd: root,
                env,
                encoding: "utf8",
                timeout: 15000,
            }
        );
        assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
        assert.equal(
            git("show", "--format=", "--name-only", "HEAD"),
            "byclaw-fe/a.txt"
        );
        assert.equal(git("diff", "--cached", "--name-only"), "byclaw-fe/b.txt");
        assert.equal(git("show", ":byclaw-fe/b.txt"), "unrelated");
        assert.equal(
            readFileSync(join(root, "nested-result.txt"), "utf8").trim(),
            "nested.txt"
        );
    } finally {
        rmSync(root, { recursive: true, force: true });
    }
});
