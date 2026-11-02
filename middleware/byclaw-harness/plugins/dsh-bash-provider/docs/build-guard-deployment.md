# Build guard — deployment checklist

The build guard rations build-class commands and steers the kernel's OOM killer
toward compiles instead of the agent. How much protection it actually delivers
depends on how the container is started, and **the plugin cannot configure that
from the inside** — a container with no memory limit stays unlimited no matter
what the guard does.

Run `build_guard_status` to see which tier is in force and what is missing.

## The three tiers

| Tier | Condition | What you get |
|---|---|---|
| **A** | cgroupfs is writable (privileged docker) | Detected and reported, but per-task sub-cgroups are **not implemented**; behaves as tier B. |
| **B** | A kernel-enforced memory ceiling exists and `memory.oom.group` is 0 | The container cannot exceed its limit, and OOM kills land on builds rather than the agent. **This is the target.** |
| **C** | No ceiling, or `memory.oom.group` is 1 | No total cap. `oom_score_adj` still steers the host-wide OOM killer toward builds, so the agent usually survives — but memory is not bounded. |

Tier is derived from probes, not from configuration. There is no "force tier B".

## Kubernetes

1. **Set `resources.limits.memory`.** Without it the guard reports
   `degraded: no-limit` and drops to tier C. This is the single highest-value
   item on this list.
2. **Set `requests.memory` equal to `limits.memory`** (Guaranteed QoS), so the
   Pod is not evicted first under node memory pressure.
3. **Size the limit** as `agent headroom + (buildSlots × peak build memory)`.
   The guard derives `-j` from what is actually free at dispatch, so a limit
   that only just covers the agent will correctly produce `-j1` rather than
   failing — it will just build slowly.
4. **Verify `memory.oom.group` before relying on tier B.** Some runtimes set it
   to 1, which kills every process in the cgroup together and makes victim
   steering useless. Check from inside a Pod:
   ```
   cat /sys/fs/cgroup/memory.oom.group
   ```
   `0` is what tier B needs. `1` shows up as `degraded: oom-group`.
5. **Do not plan around swap.** kubelet defaults to `failSwapOn: true`, and even
   with NodeSwap enabled a Guaranteed-QoS Pod gets no swap.
6. **Provide Redis** if more than one replica should share the build quota.
   Without it each replica rations independently and the configured slot count
   is *not* a global cap — the status tool says so explicitly.
7. Cross-check kills against kubelet's `container_oom_events_total`; the
   in-container `memory.events` counter is readable even on a read-only
   cgroupfs and should track it.

## Plain docker

1. **Pass `-m` / `--memory`.** Same role as `resources.limits.memory`; without
   it you are on tier C.
2. **Prefer `--cgroupns=private`** (the default on current docker). Under
   `--cgroupns=host` the container sees the *host's* cgroup tree, so the guard
   has to resolve its own path from `/proc/self/cgroup` before reading the
   limit. It does, but if that join fails you get
   `degraded: cgroupns-host-unresolved` — pairing `-m` with a private namespace
   avoids the whole question.
3. **cgroup v1 works**, with a weaker OOM signal: v1 exposes only
   `memory.failcnt`, which counts limit hits rather than kills, so verdicts are
   reported as memory *pressure* rather than confirmed kills. Nothing needs
   configuring for this; it is detected.
4. **Sharing a quota across containers on one host** needs either Redis or a
   shared lock directory bind-mounted into each container at the same path
   (`slotLockDir`). Verify that lock directory really does arbitrate across
   containers on your filesystem — the guard uses exclusive file creation plus
   a pid/start-time liveness check, which is reliable on a local filesystem but
   not guaranteed over virtiofs or NFS. If in doubt, use Redis.
5. **Tier A (`--privileged` or explicit cgroup delegation) is not worth it.**
   The sub-cgroup machinery it would unlock is not implemented, so it buys
   nothing today and costs a large privilege grant.

## Configuration

All keys are optional and go in the plugin's `cordis.patch.yml` config block.

| Key | Default | Meaning |
|---|---|---|
| `buildGuardEnabled` | `true` | Master switch. `false` makes every guard transform the identity — this is the rollback path, no code revert needed. |
| `buildSlots` | `2` | Concurrent builds allowed across the coordination domain. |
| `slotWaitSecs` | `600` | How long a build queues before proceeding unrationed. It never fails the command. |
| `memPerJobMb` | `1536` | Estimated peak memory per compile job, used to derive `-j`. Raise for template-heavy C++, lower for plain C. |
| `oomScoreAdj` | `800` | How strongly builds are preferred as OOM victims (1–1000). |
| `ulimitEnabled` | `false` | `ulimit -v` address-space backstop. **Off by default**: `RLIMIT_AS` bounds virtual address space, not resident memory, and Go, the JVM and sanitizer builds reserve far more VA than they use. Enable per-project after checking your toolchain tolerates it. |
| `slotLockDir` | `/tmp/byclaw-build-slots` | Lock directory for the single-host coordination fallback. |

## Verifying a deployment

```bash
# 1. Which tier, which coordination backend, what is degraded
#    (run the build_guard_status tool)

# 2. A build really is marked as the preferred OOM victim
make --version >/dev/null && cat /proc/self/oom_score_adj   # inside a guarded command

# 3. The agent itself is NOT marked
cat /proc/self/oom_score_adj                                 # from the agent: expect 0

# 4. Parallelism is bounded
echo "$MAKEFLAGS"                                            # inside a guarded command

# 5. The container's ceiling and OOM history
cat /sys/fs/cgroup/memory.max /sys/fs/cgroup/memory.events   # v2
cat /sys/fs/cgroup/memory/memory.limit_in_bytes              # v1
```

## What this does not do

- It does not create per-task cgroups (tier A is detected, not implemented).
- It does not change how the container is started; every item above is an
  orchestration-side action.
- It does not run an external watchdog — use k8s `restartPolicy` or docker
  `--restart`.
- It does not move builds into a separate Pod or sidecar. That is the correct
  answer if you ever need hard isolation, and the guard's admission and OOM
  reporting would carry over unchanged.
