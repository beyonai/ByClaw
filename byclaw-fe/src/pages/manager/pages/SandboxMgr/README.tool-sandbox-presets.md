# Built-in tool sandbox maintenance

`builtinToolSandboxPresets.json` contains reviewed presentation and base-resource recommendations for six templates. The manager's explicit **apply preset** action admits `byclaw-dsh-tools` to the tool market, restores its purpose, capabilities and cover, and disables login auto-start. It preserves the execution image, entrypoint, environment, existing service type and availability switch. Custom templates are unchanged. Changes take effect only after saving the specification.

`byclaw-dsh-tools` is the user's general execution environment paired with a shared Harness. It runs Shell, Python, Node, business CLIs and file-processing commands, with Chromium/remote desktop started on demand. It does not host the shared Harness. Multiple sessions lease one user instance; specialized media, Godot and Unity tasks use their respective templates. Persistent files are independent of compute lifetime.

| Template | Suggested fixed CPU / memory | Scope |
| --- | --- | --- |
| General (`byclaw-dsh-tools`) | 2 / 4Gi | Scripts, CLI and a small number of browser pages |
| Browser | 2 / 2Gi | A small number of browser pages; use 4Gi for complex or parallel pages |
| Media | 4 / 4Gi | Short videos and ordinary resolutions; increase for long videos, 4K and complex compositions |
| Godot | 4 / 4Gi | Small 2D and Web projects; increase for large 3D projects and parallel export |
| Software development | 4 / 8Gi | Node/Python build, local PostgreSQL/pgvector and browser validation share the instance |
| Unity | 4 / 8Gi | Small projects; valid Unity authorization and required build modules remain prerequisites; increase to 16Gi or more for large imports/WebGL builds |

These are starting sizes, not benchmarked maxima. Fixed MicroVM templates use the configured limits; smaller requests do not imply smaller billed resources. Presets therefore recommend equal requests and limits. Do not lower a resource profile shared with another service inadvertently.

Actual resource settings remain explicit administrative configuration: inspect the service's `serviceType` and `defaultProfileKey`, save its dedicated resource profile with `saveServiceProfile`, save the specification with `saveServiceSpec`, then rebuild its sandbox template. Applying presentation in the editor does not resize or release existing instances and does not modify profiles. Live deployments must validate real task execution before adopting lower limits.

Cover files are bundled self-contained SVG assets under `public/tool-sandbox/covers/`. The apply action resolves them against the deployment's runtime public path; it needs the updated frontend deployed. The manifest's `coverImage` values are relative asset names, so administrative scripts must resolve them to that same public path before saving metadata.

In the template editor, local PNG, JPEG and WebP covers up to 512 KB are stored as Base64 data URLs. Image URLs and site paths are stored as references. Save becomes available after the file finishes reading. If the same metadata is changed in both the form and Spec JSON, the changed form field takes precedence.

The configuration drawer loads profiles and health settings when their tabs are first opened. The user inventory requests preferred service keys with the current page. The management API shares a five-second provider status snapshot across nearby searches and filters.
