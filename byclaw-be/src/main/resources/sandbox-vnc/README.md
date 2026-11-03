# Trusted noVNC runtime

The platform serves these immutable classpath resources, never HTML or JavaScript
from a running guest. Only the authenticated WebSocket is proxied to the exact
owned sandbox's declared desktop endpoint.

`core/` and `vendor/` are unmodified noVNC 1.6.0 runtime files from Debian package
`novnc 1:1.6.0-2`, extracted from verified build image
`sha256:8c866eb7f4f73fda184561e6acd424bcbef213f8f2349b54e47b9074f12766f4`.
Upstream: https://github.com/novnc/noVNC/tree/v1.6.0 .
The extraction archive SHA256 is
`dc6358837729016f8bb3ebf2fe37e82c222f8d83dc75b87ee89c61b48ac24f0b`.
Only runtime directories and licensing files were included; examples, tests,
utilities and documentation are excluded. `index.html`, `viewer.js` and
`viewer.css` are the platform-owned entry point.

See `copyright` for upstream authors and component licenses, including MPL-2.0,
MIT/Expat, BSD and zlib notices; the MPL-2.0 text is included in `MPL-2.0`.
Do not replace these resources with files fetched from a user sandbox.
