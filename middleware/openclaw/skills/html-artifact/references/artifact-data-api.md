# Artifact Data API

Use this API as lightweight, general-purpose JSON persistence for published HTML Artifacts. It supports creating records and querying or replacing one record by its `recordKey`; it does not list records.

## Published-page API

A shared page authenticates with the `artifactId` and `accessKey` already present in its preview URL. The random `recordKey` identifies and grants access to one record. Anyone who possesses both the preview URL and a record key may query or update that record.

The published page must never call the Agent-side owner API. `BEYOND_TOKEN` is a sandbox-only secret and must not appear in page source, browser requests, generated files, build output, URLs, logs, examples, or user-visible responses. Do not substitute the token into a template or JavaScript during generation; visitors can inspect the resulting content and network traffic.

Preview URL shape:

```text
{origin}{contextPath}/artifact-preview/{artifactId}/{accessKey}/...
```

Derive the record endpoint at runtime so the context path is preserved:

```js
function artifactRecordUrl(recordKey) {
  const match = window.location.pathname.match(
    /^(.*)\/artifact-preview\/([^/]+)\/([^/]+)(?:\/.*)?$/,
  );
  if (!match) {
    throw new Error('This page is not running from an Artifact preview URL.');
  }

  const [, contextPath, artifactId, accessKey] = match;
  const base = `${window.location.origin}${contextPath}/artifact-data/${artifactId}/${accessKey}/records`;
  return recordKey ? `${base}/${encodeURIComponent(recordKey)}` : base;
}
```

### Create

```http
POST /artifact-data/{artifactId}/{accessKey}/records
Content-Type: application/json
```

```json
{
  "collectionName": "tasks",
  "data": {
    "title": "Plan trip",
    "done": false,
    "tags": ["personal"]
  }
}
```

```js
const response = await fetch(artifactRecordUrl(), {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ collectionName: 'tasks', data: taskData }),
});
const payload = await response.json();
if (!response.ok || payload.code !== 0) {
  throw new Error(payload.msg || 'Failed to save data.');
}

const { recordKey, data, version } = payload.data;
```

Retain `recordKey` when the application must retrieve or update this record later. The platform intentionally does not provide public record listing.

### Query by recordKey

```http
GET /artifact-data/{artifactId}/{accessKey}/records/{recordKey}
```

```js
const response = await fetch(artifactRecordUrl(recordKey));
const payload = await response.json();
if (!response.ok || payload.code !== 0) {
  throw new Error(payload.msg || 'Failed to load data.');
}

const { collectionName, data, version } = payload.data;
```

### Update by recordKey

Send the complete replacement JSON payload and the latest version. `collectionName` is fixed when the record is created and is not required for updates.

```js
const response = await fetch(artifactRecordUrl(recordKey), {
  method: 'PUT',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    data: updatedData,
    version,
  }),
});
const payload = await response.json();
if (!response.ok || payload.code !== 0) {
  throw new Error(payload.msg || 'Failed to update data.');
}
version = payload.data.version;
```

## Agent-side owner API

Use these endpoints only from the Agent sandbox when the Agent must initialize, query, or update records owned by the current user:

- Read the base URL from `BYAI_SERVICE_BASE_URL`.
- Read authentication from `BEYOND_TOKEN`.
- Use the `Beyond-Token` request header.
- Read variables directly in the Agent process at request time.
- Never write the token into source files, generated HTML, shell history, logs, or command output.
- Do not guess hosts, ports, context paths, or tokens.

Endpoints:

```text
POST {BYAI_SERVICE_BASE_URL}/open/api/v1/artifacts/{artifactId}/data-records
GET  {BYAI_SERVICE_BASE_URL}/open/api/v1/artifacts/{artifactId}/data-records/{recordKey}
PUT  {BYAI_SERVICE_BASE_URL}/open/api/v1/artifacts/{artifactId}/data-records/{recordKey}
```

Create, query, and update responses match the published-page API. Owner access requires Artifact ownership; no additional browser credential is involved.

## Limits and behavior

- `collectionName` must start with a letter and contain at most 64 letters, digits, `_`, or `-` characters.
- `data` must be a non-empty JSON object with at most 100 top-level fields. Its values may contain strings, numbers, booleans, nulls, arrays, and nested objects.
- Serialized JSON is limited to 64 KiB by default.
- `recordKey` is unique within an Artifact and is sufficient to locate a record after Artifact capability validation.
- Updates use optimistic locking and require the latest `version`.
- Public capabilities allow create plus record-key-based query and update. They do not allow listing all records.
- Artifact expiration or revocation immediately disables public data access.
