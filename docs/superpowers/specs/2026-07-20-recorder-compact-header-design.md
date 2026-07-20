# Recorder compact header

## Context

An active recording currently uses separate card-header and keyword-input rows before the preview. Together with the step instruction row, they consume three vertical rows and reduce the available recording area.

## Decision

Use a compact active-recording card header:

- Put the sample identity and recording-status tag on the left side of the card header.
- Put the existing keyword input on the right side of the same header row.
- Remove the duplicate keyword-input block from the preview body only while recording.
- At narrow widths, allow the header to wrap so the input remains usable instead of clipping or overlapping controls.
- Leave completed and idle card headers unchanged.

## Verification

- Add a regression test that asserts the active-recording keyword input is nested inside the compact header.
- Run targeted recorder tests, frontend lint checks, and the production build.
