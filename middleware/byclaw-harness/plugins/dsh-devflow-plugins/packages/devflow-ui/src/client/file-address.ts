/**
 * The `dsh-resource://file/…` address grammar, restated.
 *
 * The Harness owns this grammar in `@deepseek-ai/dsh-util-workspace-path`, but
 * that package is not in the client bundle's module table, so a runtime import
 * of it fails the purity gate. The slice this plugin needs is pure string work,
 * so it is repeated here. A divergence from the Harness's own encoder is a
 * defect in this copy.
 *
 * Only the `session` scope is restated. Its path may be absolute or workspace
 * relative — the Host resolves it against the root it holds for the Session —
 * so a caller holding an absolute path needs no workspace root. The Harness
 * also offers an `absolute` scope and a `cwd`-relativizing helper; neither has
 * a consumer here.
 */

/** The scheme and type every file address opens with. */
const FILE_ADDRESS_PREFIX = 'dsh-resource://file/'

/** Component-encode one id or path segment, keeping `:` literal for drive letters. */
function encodeSegment(segment: string): string {
  return encodeURIComponent(segment).replace(/%3A/gi, ':')
}

/** Encode a `/`-separated path segment by segment. */
function encodePath(path: string): string {
  return path.split('/').map(encodeSegment).join('/')
}

/**
 * Build the address of a file read through one Session.
 *
 * An absolute path keeps its leading separator as an empty first segment, which
 * is how the grammar carries it and how the Harness's parser reads it back.
 * @param sessionId - the Session whose Host workspace resolves the path.
 * @param path - absolute or workspace-relative path; backslashes are normalized to `/`, and leading `./` prefixes are dropped.
 * @returns the `dsh-resource://file/session/<sessionId>/<path>` address.
 */
export function sessionFileAddress(sessionId: string, path: string): string {
  const normalized = path.replace(/\\/g, '/').replace(/^(?:\.\/)+/, '')
  return `${FILE_ADDRESS_PREFIX}session/${encodeSegment(sessionId)}/${encodePath(normalized)}`
}

/**
 * The absolute path of one artifact registered against a card.
 *
 * `ArtifactRecord.path` is relative to the card's directory, and `DevCard.path`
 * names the card file inside it.
 * @param cardPath - the card file's absolute path.
 * @param artifactPath - the artifact's path relative to the card's directory.
 * @returns the artifact's absolute path, `/`-separated.
 */
export function artifactPathOf(cardPath: string, artifactPath: string): string {
  const directory = cardPath.replace(/\\/g, '/').replace(/\/[^/]*$/, '')
  return `${directory}/${artifactPath.replace(/\\/g, '/')}`
}
