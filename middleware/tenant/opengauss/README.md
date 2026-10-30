# Tenant OpenGauss image

Tenant-specific middleware is maintained under `middleware/tenant/`. This
OpenGauss variant provides the sandbox UID/GID and tenant startup script;
`middleware/opengauss/` remains the general-purpose image definition.

The tenant image uses a real Debian 12 runtime with apt/dpkg, systemd,
OpenSSH and sudo, as required by the Alibaba Cloud second-generation MicroVM
template provisioner. The OpenGauss 6.0.3 engine and its bundled libraries are
copied from the existing engine image. The final image keeps Debian's own
glibc, loader and package database; changing only `/etc/os-release` does not
provide a compatible runtime. The engine's private library path is scoped to
the database entrypoint and `omm` login shells, leaving MicroVM system tools
on Debian's libraries.

CI builds this variant as `byclaw-tenant-opengauss`, separately from
`byclaw-opengauss`. Changes to this directory or the BE tenant entrypoint
trigger the tenant image build. Select the tenant image explicitly in the
tenant service configuration; this directory move does not switch existing
deployments automatically.

Build from the repository root so the image copies the tenant entrypoint from
the BE module's single source file:

```bash
podman build --platform linux/amd64 -f middleware/tenant/opengauss/Dockerfile \
  -t byclaw-tenant-opengauss:local .
```

The Dockerfile retains the base image's entrypoint. Tenant services must
explicitly launch `python3 /var/lib/opengauss/byclaw-tenant-entrypoint.py gaussdb`
(as the persistence test does) to use the tenant startup adaptation.

The image contains `/var/lib/opengauss/byclaw-tenant-entrypoint.py` for
sandboxes without a volume mount. A volume mounted at `/var/lib/opengauss`
hides the image copy; BE also places the same script in the tenant volume for
that case. Tenant database data needs a persistent volume in production.

The `omm` account and default container user are both UID/GID `1001:1001`,
matching the OpenSandbox volume owner. Prepare existing database files with
that numeric ownership before using this image; the non-root entrypoint does
not change ownership of mounted files. Keep the database directory at mode
`0700`.

Mount only the database directory to retain the image's tenant startup script:

```json
{
  "scope": "PRIVATE",
  "hostPath": "${envVars.BYCLAW_SANDBOX_FILE_VOLUME_ROOT}",
  "subPath": "tenants/${envVars.TENANT_ID}/opengauss/data",
  "mountPath": "/var/lib/opengauss/data",
  "readOnly": false,
  "uid": 1001,
  "gid": 1001,
  "mode": "0700"
}
```

Use this object in the service specification's `volumes` array. The numeric
ownership fields describe the expected volume permissions; pre-existing data
still needs to be prepared on the storage host.

An optional `BASE_IMAGE` build argument can select an existing compatible
OpenGauss 6.0.3 engine image on a build host. It is the extraction stage, not
the final operating system. `RUNTIME_IMAGE` defaults to `debian:12-slim`;
overrides must provide a Debian/Ubuntu runtime compatible with the engine's
ELF and library requirements. The build runs `verify-runtime.sh` as `omm` to
check the real distribution, required system commands, UID/GID, core dynamic
dependencies and tenant entrypoint before an incompatible image is published.

On a Linux Docker host, verify default ownership and persistence with a
disposable database and bind mount:

```bash
bash middleware/tenant/opengauss/test-persistence.sh byclaw-tenant-opengauss:local
```

This test checks the runtime first, initializes a disposable database, and
checks that data survives container recreation. It does not validate an
Alibaba Cloud template build or a real AgenticFS mount. After publishing the
correct image, rebuild the `tenant-opengauss` sandbox template before retrying
tenant provisioning. Use a new release tag when changing image contents.
