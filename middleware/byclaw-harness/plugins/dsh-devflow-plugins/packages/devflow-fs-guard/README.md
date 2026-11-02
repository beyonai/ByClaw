# @zhchxiao123/dsh-devflow-fs-guard

English | [中文](README.zh.md)

Devflow state protection on the `fs/*` intent waterfalls: any file-tool mutation (`write`, `edit`, `str_replace_editor`) whose target path contains a protected directory segment is denied in the tool executor with the structured `FS_SANDBOX_DENIED` before the `ctx.fs` provider runs, and the denial message points the model at the devflow tools. Code stays fully writable; the card journal, projections, and leases change only through [`ctx.devflow`](../devflow/README.md), whose store writes host-side and therefore keeps the transition executor — revision CAS, edge legality, rework reasons, the [gates](../devflow-gates/README.md) waterfall — the only write path over the card history. Reads pass through untouched: the model may always inspect the journal it cannot forge.

The plugin registers no service and injects none; it is the policy third of the devflow stack the same way [`dsh-fs-observation-policy`](../../fs/fs-observation-policy/README.md) is for observed state, deployed beside the gate configuration in the profile.

Three kinds of state live under the protected root, and the denial names the write path that fits the target: a path whose protected segment is followed by `spec` points at `devflow_write_spec`, one followed by `iron-rules` at `devflow_record_iron_rule`, anything else at the card tools. Sending a spec or rule author to a tool that cannot write their file is a denial that technically holds and practically misleads.


## Config

```yaml
- id: devflow-fs-guard
  name: '@zhchxiao123/dsh-devflow-fs-guard'
  config:
    directories: ['.devflow']
```

| Key | Default | Meaning |
|---|---|---|
| `directories` | `['.devflow']` | Directory names whose subtrees the file tools must not mutate, matched against every path segment of a mutation target. Bare names only; an empty or ill-formed list fails the load (unload the plugin to guard nothing). |

## Model Experience

### Tool results

#### What the model sees

No schema or prompt changes. A denied mutation returns the file tool's error result carrying the guard's message — the target path, the protected directory list, and the instruction to use `devflow_transition`/`devflow_create` instead.

#### Token effect

None until a denial; a denial costs one short error result.

#### KV Cache effect

None; the package never assembles or sends provider requests.

## Known Limitations and Deferred Work

- **A policy fence, not a kernel boundary** — shell writes are confined only by the composed kernel sandbox, whose workspace-write profile still includes the devflow root; carving the protected directories out of the shared `writableRoots` set would extend the fence to bash and is deferred with the sandbox work.
- **Name matching, not root matching** — protection keys on directory names anywhere in the target path, not on resolved devflow roots, so a code directory that happens to be named `.devflow` is also read-only to the file tools.
