#!/bin/bash
# Runs inside the harness (A) image during the Dockerfile.tools build. Writes $1 (a tar) with the
# files B needs under /workspace: the DSH SSH helper, the PTC bootstrap and their dependency closure,
# at the same paths as in A, which verifies them by digest.
set -euo pipefail
out=${1:?output tar}
here=$(cd "$(dirname "$0")" && pwd)
cd /workspace/packages/ssh/ssh
export TRACE_OUT=/tmp/tool-env-trace.txt TRACE_HOOK=$here/trace-hook.mjs
: > "$TRACE_OUT"
node "$here/trace-main.mjs"
sort -u "$TRACE_OUT" > /tmp/tool-env-files.txt
echo "resolved files: $(wc -l < /tmp/tool-env-files.txt)"
python3 - <<'PY'
import os, json
files = [l.strip() for l in open('/tmp/tool-env-files.txt') if l.strip()]
roots = set(); nm_dirs = set(); extra = set()
def pkg_root(p):
    d = os.path.dirname(p)
    while d.startswith('/workspace'):
        if os.path.exists(os.path.join(d, 'package.json')): return d
        d = os.path.dirname(d)
    return None
for f in files:
    rp = os.path.realpath(f)
    r = pkg_root(rp)
    if r: roots.add(r)
    else: extra.add(rp)
    # every node_modules dir on the ancestor chain (symlink entries needed for resolution)
    d = os.path.dirname(rp)
    while d.startswith('/workspace'):
        if os.path.basename(d) == 'node_modules': nm_dirs.add(d)
        nd = os.path.join(d, 'node_modules')
        if os.path.isdir(nd): nm_dirs.add(nd)
        d = os.path.dirname(d)
# native system packages (PTY / landlock launchers) and the workspace manifests
for p in ['/workspace/native/system/packages/linux-x64', '/workspace/native/system/packages/entry', '/workspace/package.json', '/workspace/pnpm-workspace.yaml']:
    if os.path.exists(p): extra.add(p)
# CJS/FFI packages the subprocess runtime loads with require() at runtime (invisible to the ESM resolve hook).
for link in ['/workspace/packages/subprocess/subprocess-local/node_modules/node-pty', '/workspace/packages/subprocess/subprocess-local/node_modules/koffi']:
    if os.path.exists(link):
        roots.add(os.path.realpath(link)); nm_dirs.add(os.path.dirname(link))
        d = os.path.dirname(os.path.realpath(link))
        if os.path.basename(d) == 'node_modules': nm_dirs.add(d)
for r in list(roots):
    nd = os.path.join(r, 'node_modules')
    if os.path.isdir(nd): nm_dirs.add(nd)
json.dump({'roots': sorted(roots), 'nm': sorted(nm_dirs), 'extra': sorted(extra)}, open('/tmp/tool-env-plan.json', 'w'), indent=1)
print('package roots:', len(roots), 'node_modules dirs:', len(nm_dirs), 'extra:', len(extra))
PY
# Package roots without their node_modules subtrees and sources; node_modules symlink entries (no
# recursion); the extras. Platform payloads: linux-x64 only.
python3 - <<'PY'
import os, json
plan = json.load(open('/tmp/tool-env-plan.json'))
out = open('/tmp/tool-env-tarlist.txt', 'w')
for r in plan['roots']:
    for base, dirs, fs in os.walk(r):
        dirs[:] = [d for d in dirs if d not in ('node_modules', 'src', 'tests', 'test', '__tests__', 'docs', '.turbo', 'third_party')]
        if os.path.basename(base) == 'prebuilds': dirs[:] = [d for d in dirs if d == 'linux-x64']
        if base.endswith('/build/koffi'): dirs[:] = [d for d in dirs if d == 'linux_x64']
        for f in fs:
            if f.endswith(('.ts', '.map', '.tsbuildinfo', '.md')) and not f.endswith('.d.ts'): continue
            out.write(os.path.join(base, f) + '\n')
for nd in plan['nm']:
    for e in os.listdir(nd):
        p = os.path.join(nd, e)
        if os.path.islink(p): out.write(p + '\n')
        elif e.startswith('@') and os.path.isdir(p):
            for e2 in os.listdir(p):
                p2 = os.path.join(p, e2)
                if os.path.islink(p2): out.write(p2 + '\n')
for x in plan['extra']:
    if os.path.isdir(x):
        for base, dirs, fs in os.walk(x):
            for f in fs: out.write(os.path.join(base, f) + '\n')
    else: out.write(x + '\n')
out.close()
PY
sort -u /tmp/tool-env-tarlist.txt > /tmp/tool-env-tarlist.sorted
echo "tar entries: $(wc -l < /tmp/tool-env-tarlist.sorted)"
tar -cf "$out" --no-recursion -T /tmp/tool-env-tarlist.sorted
ls -la "$out"
