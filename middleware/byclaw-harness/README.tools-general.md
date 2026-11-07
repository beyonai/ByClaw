# General tool sandbox

`byclaw-dsh-tools` is a user-scoped execution sandbox paired with the shared Harness. It runs the user's Shell, Python, Node and business CLI commands, processes files, and starts its Chromium/remote desktop on demand. It does not run the shared Harness application. The general environment retains the full toolchain from its matching full Harness image; browser-only, media and game templates remain separate choices.

Build `Dockerfile.tools` from the repository root with a compatible full `HARNESS_IMAGE`. The image trims the Harness application while retaining its SSH/PTC helper dependency closure and browser stack. A slim Harness image is not a valid donor for this full-stack image. The runtime publishes `/etc/byclaw-tool-sandbox/capabilities.json` with purpose `general`, matching the template market's strict admission handshake.

The recommended starting specification is 2 CPU / 4Gi for scripts, CLI tools and a small number of browser pages. Large builds, batch processing and parallel browser workloads need larger profiles. Suggestions are not load-test guarantees. The tool market's built-in administrative preset maintains its description, capabilities, cover and this sizing guidance; actual service/resource configuration and template rebuild remain explicit administrative operations.

Sessions acquire separate leases against one user-scoped instance. Last-lease expiry/return starts the configured idle timeout (default five minutes); shared user-context cleanup also reclaims the user's tool resources. Persistent files belong to the generic filesystem and remain independent of the instance lifetime.
