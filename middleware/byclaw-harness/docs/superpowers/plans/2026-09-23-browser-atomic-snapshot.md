# Browser atomic snapshot implementation

The approved research direction is implemented here as one independently verifiable runtime optimization. Preserve the public browser tool contract, policy enforcement, lease ownership, download lifecycle, and Playwright actionability checks.

- [x] Measure warm observations for 20, 100, and 200 controls using the current driver and seven samples per size.
- [x] Introduce a private browser-side snapshot registry. A WeakMap owns stable node identities; only the most recently observed nodes remain actionable. Keep its reference in a JSHandle, never a DOM attribute or window property. Drop the registry on navigation and close; never reuse an old numeric index.
- [x] Read element descriptions, text, blocking layers, document identity, and fingerprints synchronously in one evaluation. Preserve open-shadow-root discovery, hidden/offscreen metadata, text bounds, password redaction, and submission flags. Include node identity in structure fingerprints so identical node replacement is detected.
- [x] Acquire an ElementHandle only for the requested action target; retain Playwright click/fill/select behavior. Dispose cached action handles on new observations and document changes.
- [x] Let BrowserRuntime prefer the atomic driver API while retaining the legacy API for custom drivers. Read the same fingerprint representation immediately before and after an action without altering the observed target set.
- [x] Add real-browser regressions for reorder/replacement/navigation, unknown IDs, shadow DOM, password redaction, page-global tampering, bounded output, and constant evaluation count. Add a runtime regression proving inspect consumes the atomic result and never the legacy reads.
- [x] Run the package tests, typecheck, build, and the identical benchmark. Document measured outcomes and remaining phases.

Target guards, adaptive UI settling, and a new step operation are follow-up phases: the atomic snapshot is the prerequisite and this change must establish its independent performance and compatibility evidence first. Existing single-item `act` already returns action plus final observation and remains available without a new public operation.
