#!/usr/bin/env node
// The `tools` mode of docker-entrypoint.sh: what the tool sandbox (B) does before serving SSH.
import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const entrypoint = fileURLToPath(new URL('../docker-entrypoint.sh', import.meta.url))

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), 'tools-entry-'))
  const server = join(root, 'server')
  await writeFile(server, '#!/bin/sh\nprintf "%s\\n" "server $*" >>"$CAPTURE"\n')
  await chmod(server, 0o755)
  const env = {
    ...process.env, CAPTURE: join(root, 'calls'),
    BYCLAW_TOOL_ENV_SERVER: server,
    BYCLAW_TOOL_HOME: join(root, 'home'),
    BYCLAW_TOOL_HOME_SEED: join(root, 'seed'),
    // No browser supervisor here: these cases are about the home directory.
    BYCLAW_TOOL_BROWSER: '0',
  }
  return { root, env, run: () => spawnSync('bash', [entrypoint, 'tools'], { env, encoding: 'utf8' }) }
}

test('a persistent home starts from the image home and keeps what the user changed', async () => {
  const { root, env, run } = await fixture()
  try {
    const seed = env.BYCLAW_TOOL_HOME_SEED
    await mkdir(join(seed, '.lark-cli'), { recursive: true })
    await writeFile(join(seed, '.bashrc'), 'image bashrc\n')
    await writeFile(join(seed, '.lark-cli', 'config.json'), '{"image":true}\n')
    // First start on an empty volume: the image home appears.
    await mkdir(env.BYCLAW_TOOL_HOME)
    let result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.bashrc'), 'utf8'), 'image bashrc\n')
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.lark-cli', 'config.json'), 'utf8'), '{"image":true}\n')
    // The user changes and adds files; a newer image adds a default of its own.
    await writeFile(join(env.BYCLAW_TOOL_HOME, '.bashrc'), 'user bashrc\n')
    await mkdir(join(env.BYCLAW_TOOL_HOME, '.openclaw'))
    await writeFile(join(env.BYCLAW_TOOL_HOME, '.openclaw', 'credentials'), 'token\n')
    await writeFile(join(seed, '.profile'), 'new default\n')
    result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.bashrc'), 'utf8'), 'user bashrc\n')
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.openclaw', 'credentials'), 'utf8'), 'token\n')
    assert.equal(await readFile(join(env.BYCLAW_TOOL_HOME, '.profile'), 'utf8'), 'new default\n')
    assert.equal(await readFile(env.CAPTURE, 'utf8'), 'server \nserver \n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('an image without a home seed just serves SSH', async () => {
  const { root, env, run } = await fixture()
  try {
    const result = run()
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(env.CAPTURE, 'utf8'), 'server \n')
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('the browser supervisor runs first and serves SSH as its child, without the secret', async () => {
  const { root, env } = await fixture()
  try {
    delete env.BYCLAW_TOOL_BROWSER
    // Stands in for byclaw-browser-supervisor: records its options, then runs the
    // command after `--` the way it does, with the secret on an inherited descriptor.
    const supervisor = join(root, 'supervisor')
    await writeFile(supervisor, `#!/usr/bin/env python3
import os, subprocess, sys
args = sys.argv[1:]
with open(os.environ["CAPTURE"], "a") as out:
    out.write("supervisor " + " ".join(args[:args.index("--")]) + "\\n")
    out.write("profile " + os.environ.get("BYCLAW_BROWSER_USER_DATA_DIR", "") + "\\n")
    out.write("bycli-host " + os.environ.get("BYCLI_DAEMON_HOST", "") + "\\n")
    out.write("image " + os.environ.get("BYCLAW_BROWSER_VIEWER", "") + " " + os.environ.get("BYCLAW_BYCLI_ENABLED", "") + " " + os.environ.get("TZ", "") + "\\n")
read, write = os.pipe()
os.write(write, b"s3cret"); os.close(write)
env = dict(os.environ, BYCLAW_BROWSER_SECRET_FD=str(read), BYCLAW_DSH_PREPARED="1", BYCLAW_BROWSER_SECRET="s3cret")
sys.exit(subprocess.run(args[args.index("--") + 1:], env=env, pass_fds=(read,)).returncode)
`)
    await chmod(supervisor, 0o755)
    env.BYCLAW_TOOL_BROWSER_SUPERVISOR = supervisor
    // The image settings the supervisor reads live in the recorded session environment
    // (the flattened image keeps few ENV lines); the sandbox's own spec env wins.
    env.BYCLAW_TOOL_ENV_SESSION_ENV = join(root, 'session-env')
    await writeFile(env.BYCLAW_TOOL_ENV_SESSION_ENV, 'BYCLAW_BROWSER_VIEWER=shared-novnc\nBYCLAW_BYCLI_ENABLED=true\nTZ=UTC\nnot a variable\n')
    env.TZ = 'Asia/Shanghai'
    // The SSH server must start with neither the descriptor nor the secret variables.
    await writeFile(env.BYCLAW_TOOL_ENV_SERVER, `#!/usr/bin/env python3
import os
leaked = [name for name in ("BYCLAW_BROWSER_SECRET_FD", "BYCLAW_BROWSER_SECRET", "BYCLAW_DSH_PREPARED") if name in os.environ]
open_fds = [fd for fd in os.listdir("/proc/self/fd") if int(fd) > 2]
with open(os.environ["CAPTURE"], "a") as out:
    out.write("server leaked=%s socket=%s\\n" % (",".join(leaked), os.environ.get("BYCLAW_BROWSER_SOCKET", "")))
    for fd in open_fds:
        try:
            if os.readlink("/proc/self/fd/" + fd).startswith("pipe:"): out.write("server inherited a pipe\\n")
        except OSError: pass
`)
    const result = spawnSync('bash', [entrypoint, 'tools'], { env, encoding: 'utf8' })
    assert.equal(result.status, 0, result.stderr)
    assert.equal(await readFile(env.CAPTURE, 'utf8'), [
      'supervisor --browser-user byclaw --dsh-user root --socket-path /run/byclaw-browser/browserd.sock'
        + ' --secret-file /run/byclaw-browser/broker.secret --readiness-timeout 60'
        // The browser starts on first use, including a first request to byCLI's port from BE.
        + ' --activation-port 19825',
      // The profile the user's own sandbox used, on the user's volume: earlier logins carry over.
      'profile /by/byclaw/.dsh/browser/user-data',
      // BE reaches byCLI's daemon through the sandbox's `bycli` endpoint.
      'bycli-host 0.0.0.0',
      'image shared-novnc true Asia/Shanghai',
      'server leaked= socket=/run/byclaw-browser/browserd.sock',
      '',
    ].join('\n'))
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})
