# Content creation Python runtime

`byclaw-caps` is private: install the checked-in wheel directly, never resolve it by name from a public package index. Public dependencies still use the image pip index.

- `byclaw_caps-0.7.6-py3-none-any.whl`: built with `uv build --wheel` from byclaw-devloop `operation/src/writing_capabilities` (version 0.7.6), using a temporary source copy.
- `ppt-requirements.txt`: copied from byclaw-devloop `operation/skills/ppt-master/requirements.txt`. Includes NumPy for video music helpers.
- `SHA256SUMS`: verifies both inputs before installation.

When updating, rebuild the wheel from the intended source revision, copy the PPT requirements, refresh SHA256SUMS, and update both Harness Dockerfiles if the wheel filename changes. The documents extra enables article PDF extraction. Browser setup and project-local npm installation are unchanged.
