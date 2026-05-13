# Commit convention (Conventional Commits)

Recommended format:

```
<type>(<scope>): <subject>

<body>

<footer>
```

## Common `type` values

| type | Meaning |
|------|---------|
| `feat` | New feature |
| `fix` | Bug fix |
| `docs` | Documentation only |
| `style` | Formatting (no logic change) |
| `refactor` | Refactor |
| `test` | Tests |
| `chore` | Tooling, build, misc |

## `scope` (optional)

Maps to this repo, e.g. `fe`, `be`, `exe`, `docs`, `ci`.

## Examples

```
feat(fe): add locale switcher on login
fix(be): correct pagination boundary
docs: document quick-start env vars
```

See <https://www.conventionalcommits.org/>
