# Internal tenant service authentication

The commercial tenant endpoints use an independent service identity. Existing Node KMS/schema/orchestrator internal endpoints keep their existing authentication. Browser cookies, actor IDs, tenant selector headers and user sessions grant no service authority.

Enable `byclaw.integration.security.enabled` explicitly. Configure `clients.<clientId>.secret`, `source-system`, `scopes`, `enterprise-ids` and `all-tenants` using deployment secrets/configuration. Secrets must contain at least 32 UTF-8 bytes of cryptographically random key material; shorter keys fail closed. All tenants defaults to false; scopes and enterprise IDs default to empty. No credentials are provided in this document. `max-skew-seconds` defaults to 300 and must be between 1 and 3600. Redis must be shared by backend replicas; unavailable replay storage fails closed.

Every request sends exactly one of each header:

- `X-ByClaw-Client-Id`: configured client key, ASCII letters/digits/underscore/hyphen, 1–100 characters.
- `X-ByClaw-Timestamp`: Unix epoch seconds in decimal, 1–12 digits.
- `X-ByClaw-Nonce`: fresh cryptographically random URL-safe string, 16–128 letters/digits/underscore/hyphen.
- `X-ByClaw-Signature`: lowercase 64-character hexadecimal HMAC-SHA256.

Canonical signing input is UTF-8 bytes of the following fields joined by one LF (`0A`), with **no final LF**:

```text
BYCLAW-HMAC-SHA256-V1
HTTP_METHOD
RAW_REQUEST_URI
RAW_QUERY_OR_EMPTY
LOWERCASE_HEX_SHA256_OF_RAW_BODY
TIMESTAMP_HEADER
NONCE_HEADER
CLIENT_ID_HEADER
```

`RAW_REQUEST_URI` includes the servlet context prefix if configured and excludes the query delimiter. Query bytes are the exact transmitted raw query string, including parameter order, percent escapes and repeated keys; do not decode or sort them. An absent query is empty. Body hash covers exact transmitted bytes; empty GET bodies hash the empty byte sequence. The HTTP method is case sensitive. The signature key is the UTF-8 bytes of the configured secret, without decoding. Proxies must preserve the signed URI/query. This strict representation is canonical: callers sign the exact wire representation they send.

Verify timestamp inclusively within the configured skew and compare signatures in constant time. Reserve nonce with atomic Redis SET NX and TTL `2 * maxSkewSeconds + 1` after signature and route permissions pass. Business retries send a new nonce and retain the same business requestId. Replay namespaces include clientId. Bodies are limited to 1 MiB.

| Method/path | Required scope |
| --- | --- |
| POST `/internal/v1/tenant-provisionings` | `tenant:provision` |
| GET `/internal/v1/commands/{decimalId}` | `tenant:read` |
| GET `/internal/v1/commands/by-request` | `tenant:read` |
| GET `/internal/v1/tenants/{decimalId}/runtime` | `tenant:read` |
| PUT `/internal/v1/tenants/{decimalId}/execution-policy` | `tenant:policy:write` |
| POST `/internal/v1/tenants/{decimalId}/operations` | `sandbox:operate` |
| GET `/internal/v1/tenants/{decimalId}/enterprise` | `tenant:read` |
| PUT `/internal/v1/tenants/{decimalId}/enterprise` | `tenant:manage` |
| GET `/internal/v1/tenants/{decimalId}/members` | `tenant:read` |
| POST `/internal/v1/tenants/{decimalId}/members` | `tenant:manage` |
| POST `/internal/v1/shared-workspaces/{decimalId}/members` | `tenant:manage` |

The shared-workspace member route is a generic technical integration boundary for a pre-initialized
workspace that does not run a separate tenant Node. It is restricted to an all-tenants service
principal and does not accept package, trial, price or entitlement fields. HACU owns those commercial
facts and calls this route only to apply the resulting generic `MEMBER` membership change; the route
does not require an OWNER row in the shared workspace.

The filter requires credential tenant permission for URL tenant IDs. Controllers obtain `InternalServicePrincipal.require(request)` and **must** call `requireSource` for supplied sourceSystem and `requireTenant` for body targets or command-owned enterprise IDs before reading/mutating business state. Actor is audit data only. Never derive source authority from the body. The immutable principal exposes only configured identity and authorities; secrets are excluded.

Authentication failures return actual HTTP 401, scope/source/target denial HTTP 403, oversized body HTTP 413, using `application/problem+json` with `errorCode` and generated `traceId`. Controller layers must preserve those semantics for business-boundary authorization failures. Integration disabled fails closed on commercial routes; ordinary user routes retain their existing behavior.

Authentication rejection logs use the same generated `traceId` as the response. Search backend logs by that value when a caller receives `SERVICE_AUTH_INVALID`. The response remains generic; the server-only `reason` distinguishes `INTEGRATION_DISABLED`, `HEADER_MISSING`, `HEADER_INVALID`, `CLOCK_SKEW_INVALID`, `TIMESTAMP_OUT_OF_WINDOW`, `CLIENT_NOT_CONFIGURED`, `CLIENT_SECRET_INVALID`, `SIGNATURE_MISMATCH`, `ROUTE_NOT_ALLOWED`, `NONCE_REPLAYED`, `NONCE_STORE_UNAVAILABLE` and `AUTHENTICATION_ERROR`. Oversized input uses `BODY_TOO_LARGE`; security exceptions without a diagnostic classification use `REQUEST_REJECTED`. Rejections log at WARN; unavailable nonce storage logs at ERROR and still denies the request. Logged fields are `reason`, `status`, an allowlisted `method`, an allowlisted path with numeric IDs replaced by `{id}`, and `traceId`. Credentials, client-supplied identity, signatures, nonces, bodies, queries, raw headers, authority configuration and exception messages/stacks are excluded.

The internal controller exception handler also logs `status`, a stable `errorCode`, the exception class and the response's `traceId` (WARN for 4xx, ERROR for 5xx). The expected `404/COMMAND_NOT_FOUND` lookup result logs only at DEBUG and bypasses the legacy exception aspect's ERROR/incident persistence; its HTTP status, code and trace ID remain unchanged. Other failures retain their existing diagnostics.

Provisioning worker failures log `commandId`, `enterpriseId`, `status=MANUAL_REQUIRED`, a safe stage, a stable `errorCode` and the original exception class after the failure acknowledgement commits. Failure to acknowledge logs both exception classes without their messages. `failurePath` includes up to eight cause types and the first application class/method/line for each cause, with cycle protection. It excludes exception messages, file paths, request payloads and credentials. This distinguishes file preparation failures from Redis shutdown or provider failures without printing their sensitive payloads. Public and worker error codes must match `[A-Z][A-Z0-9_]{1,79}`; malformed values become `REQUEST_REJECTED` in the controller and `PROVIDER_RESULT_UNKNOWN` in the worker. See [provisioning diagnostics](tenant-provisioning-diagnostics.md) for read-only reconciliation queries.

Verification sources include `InternalServiceAuthenticationTest`, `InternalServiceAuthenticationDiagnosticsTest`, `ExceptionLogAspectTest`, `TenantInternalExceptionHandlerDiagnosticsTest` and `TenantCommandWorkerDiagnosticsTest`; deployment interoperability, TLS/proxy configuration and live shared Redis behavior require integration acceptance.
