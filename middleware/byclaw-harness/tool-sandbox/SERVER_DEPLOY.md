# Direct deployment to a user's server

This optional path uses SSH/SCP directly in the coding sandbox. It does not add a
deployment service or store ECS keys in the image. The platform-proxy alternative
remains deferred. The server-deploy Skill and `server-ssh` CLI are application-neutral.

## Personal configuration

Only `BYCLAW_DEPLOY_HOST` and `BYCLAW_DEPLOY_PRIVATE_KEY` are required. Configure and enable
these two records in the current user's private parameters, never in a shared template env.
All other parameters are optional overrides:

| Parameter | Value |
|---|---|
| `BYCLAW_DEPLOY_ENABLED` | Optional. Both required parameters enable delivery by default; set `0` to pause or `1` to explicitly enable |
| `BYCLAW_DEPLOY_HOST` | ECS IPv4 address or DNS name (IPv6 is not supported in v1) |
| `BYCLAW_DEPLOY_PORT` | SSH port; omitted/empty means 22 |
| `BYCLAW_DEPLOY_USER` | Optional; defaults to `root`. Override when the ECS uses a different SSH account |
| `BYCLAW_DEPLOY_PRIVATE_KEY` | Dedicated unencrypted SSH private key. For the single-line personal-parameter input, use `base64 -w 0 ~/.ssh/byclaw_deploy`; complete multiline PEM/OpenSSH content is also accepted |
| `BYCLAW_DEPLOY_HOST_KEY` | Optional manually verified server public key: algorithm + base64. Omit to automatically record the first server identity |
| `BYCLAW_DEPLOY_ROOT` | Optional. Omit or leave blank to use `~/apps` in the deployment account's home; override with an absolute directory other than `/` |

Never paste the private key into chat. By default, first connection uses OpenSSH
`accept-new` and persists only the public server identity in `/by/.server-deploy/known_hosts`.
Later connections, including fresh coding instances, reject changed keys. This assumes
the first connection reaches the correct server; it is trust on first use, not an
independent identity check. For preverified identity, optionally supply the host public
key obtained through a trusted server console.
Passphrase/password authentication and interactive prompts are intentionally unsupported.
The client must support `scp -s` (OpenSSH 8.9 or later); uploads explicitly use SFTP
instead of depending on the installed client's default transfer protocol.
Use a disposable deployment identity, not the user's normal administrator key.

Ordinary setups need no deployment-directory parameter: the CLI creates `~/apps`
on first use. Keep different applications in subdirectories such as
`easel/releases/v001/`. `BYCLAW_DEPLOY_PORT` is also optional and defaults to 22.
Custom paths remain available for servers with an existing deployment layout.

The existing personal-parameter storage encrypts DB values using its existing
default-key mechanism and caches decrypted enabled values in Redis. This feature
does not upgrade that mechanism to a vault. Platform administrators and the trusted
per-user Harness context retain access to the configured material.

## Execution boundary

`BYCLAW_DEPLOY_*` is reserved: normal tool subprocesses drop it even if a caller
tries to supply it. Only the internal coding executor can use the dedicated catalog
method; ownership and coding-template checks still apply. Configuring both enabled
required parameters activates delivery unless explicitly paused. While active,
all routed Codex tasks for this user receive this capability. Natural-language intent
is not an authorization control; disable it after the authorized deployment period.
There is no isolation against another process with the same OS user/root in the
same coding instance, including concurrent tasks belonging to the same user.

The lease-local runner removes the raw values from Codex's inherited environment,
creates a mode-0700 `/tmp/byclaw-deploy-*` directory and mode-0600 context file,
and passes only its path to Codex. No key enters prompt, manifest argv, `/by`, native
config, file-change snapshots or the image. The CLI materializes a key and a manually pinned
known_hosts only for each SSH/SCP invocation and removes them on exit. In first-use
mode the public known_hosts file persists; it contains no login private key. The runner
removes the task context on normal completion, failures and handled cancellation.
SIGKILL/host crashes can leave files until the instance is destroyed; five-minute
idle collection is not immediate revocation. Disabling a parameter does not erase
copies held by running processes. Revoke the public key on the ECS to revoke SSH access.

The context is not a security boundary against Codex, which can use this account
and read the task-local files. The CLI's root is a working directory and upload
prefix, not a remote filesystem jail. Ordinary Docker access is effectively server
administration. Remote process cancellation requires checking remote state; ending
the local SSH connection does not prove the remote operation stopped.

## Build and verification

Publish both the Harness image (execution filtering, routing, runner) and
`Dockerfile.tools.coding` (OpenSSH client, CLI, built-in Skill). Refresh templates
and validate with new instances. Do not inject these variables into cloud template
startup env or `/etc/byclaw-tool-env.session-env`, which bypasses process-scoped delivery.

Local checks use disposable synthetic keys and isolated targets, never user credentials:

```bash
python3 -m unittest discover -s middleware/tests -p 'test_server_ssh.py' -v
python3 middleware/byclaw-harness/plugins/byclaw-integration/scripts/coding-workspace-verify.py
```

For real OpenSSH/SFTP loopback acceptance, create a disposable test venv, install
`paramiko==5.1.0` from the configured domestic Python index, then run
`python -m unittest discover -s middleware/tests -p 'test_server_ssh*.py' -v` in
that venv. Paramiko is test-only; it is not installed in the production image.

Online acceptance must cover manual pin mismatch and first-use key change rejection, successful upload and
remote execution, task cancellation/cleanup, and a real application request. Source
tests alone do not establish that image builds, domestic package downloads or ECS
network access work.
