# Bundled DWS CLI

The `dws` executable in this directory is the version bundled into the
ByClaw Harness image.

| Item | Value |
| --- | --- |
| Version | `v1.0.52` |
| Build | `4e59f9a`, `2026-07-15T01:10:43Z` |
| Source | npm package `dingtalk-workspace-cli@1.0.52` (`assets/dws-linux-amd64.tar.gz`) |
| Platform | `linux-amd64` (x86-64) |
| Binary SHA256 | `53bdea905817fe756a22682f0b640063bc78c6d970c14aeb71297923b12de59f` |
| Source archive SHA256 | `b7dfd9a4b3489211359261747ed0cb9c8c261434bb762ad3f76df33bdbabd5cb` |

The bundled executable is currently the amd64 build. When upgrading DWS,
update this document and verify the image with:

```bash
dws --version
sha256sum builtin/cli/dws
```

The DWS credentials are supplied at runtime; no credentials are stored in
this directory or in the image source.
