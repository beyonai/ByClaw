# githooks (samples)

Git reads hooks from `.git/hooks`, which is **not** usually committed. These files are templates you can copy or symlink, or replace with Husky (`byclaw-fe`), pre-commit, etc.

## Example: install `pre-commit` by copy

```bash
chmod +x scripts/githooks/pre-commit.sample
cp scripts/githooks/pre-commit.sample .git/hooks/pre-commit
```

Edit the hook to run `pnpm run lint`, module tests, or other checks you need.
