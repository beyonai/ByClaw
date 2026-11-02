// The restated `dsh-resource://file/…` encoder. Every case here is one the
// Harness's own encoder answers the same way; a divergence is a defect in the
// copy, so these read as the contract rather than as this file's preferences.
import { describe, expect, it } from 'vitest'
import { artifactPathOf, sessionFileAddress } from '../src/client/file-address.ts'

describe('sessionFileAddress', () => {
  it('carries an absolute path as an empty first segment, which is how the grammar spells it', () => {
    expect(sessionFileAddress('ses-1', '/ws/.devflow/tasks/0001/artifacts/design.md'))
      .toBe('dsh-resource://file/session/ses-1//ws/.devflow/tasks/0001/artifacts/design.md')
  })

  it('leaves a workspace-relative path without that empty segment', () => {
    expect(sessionFileAddress('ses-1', 'notes/design.md'))
      .toBe('dsh-resource://file/session/ses-1/notes/design.md')
  })

  it('component-encodes each segment, so a name carrying a space or a hash survives', () => {
    expect(sessionFileAddress('ses-1', 'a b/c#d?e.md'))
      .toBe('dsh-resource://file/session/ses-1/a%20b/c%23d%3Fe.md')
  })

  it('encodes the session id too', () => {
    expect(sessionFileAddress('ses/1 2', 'a.md')).toBe('dsh-resource://file/session/ses%2F1%202/a.md')
  })

  it('keeps a colon literal, so a Windows drive letter reads as written', () => {
    expect(sessionFileAddress('ses-1', 'C:/ws/a.md')).toBe('dsh-resource://file/session/ses-1/C:/ws/a.md')
  })

  it('normalizes backslashes and drops a leading ./', () => {
    expect(sessionFileAddress('ses-1', '.\\ws\\a.md')).toBe('dsh-resource://file/session/ses-1/ws/a.md')
  })

  it('keeps both empty segments of a UNC path', () => {
    expect(sessionFileAddress('ses-1', '//server/share/a.md'))
      .toBe('dsh-resource://file/session/ses-1///server/share/a.md')
  })
})

describe('artifactPathOf', () => {
  it('resolves an artifact against the directory holding the card file', () => {
    expect(artifactPathOf('/ws/.devflow/tasks/0001-x/card.md', 'artifacts/2-requirements-document.md'))
      .toBe('/ws/.devflow/tasks/0001-x/artifacts/2-requirements-document.md')
  })

  it('normalizes a Windows card path so the address grammar sees one separator', () => {
    expect(artifactPathOf('C:\\ws\\.devflow\\tasks\\0001\\card.md', 'artifacts\\design.md'))
      .toBe('C:/ws/.devflow/tasks/0001/artifacts/design.md')
  })
})
