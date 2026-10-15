import { beforeEach, afterEach, expect, it, vi } from 'vitest'
import { lstat, mkdir, mkdtemp, open, realpath, rm, symlink, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { projectPolicies } from '../src/project-policies.ts'
vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>()
  return { ...actual, lstat: vi.fn(actual.lstat), realpath: vi.fn(actual.realpath), open: vi.fn(actual.open) }
})
let root: string
const requirement = { validators: ['midscene:project'], edges: ['testing->done'], timeoutMs: 1000 }
const policy = { version: 1, requirements: [requirement] }
beforeEach(async () => {
  vi.mocked(lstat).mockReset(); vi.mocked(realpath).mockReset(); vi.mocked(open).mockReset()
  root = await realpath(await mkdtemp(join(tmpdir(), 'project-policy-')))
})
afterEach(async () => { await rm(root, { recursive: true, force: true }) })
const save = (value: unknown) => writeFile(join(root, 'validation.json'), JSON.stringify(value))
it('reads optional project requirements with portable project-local scope', async () => {
  expect(await projectPolicies(join(root, 'absent'))).toEqual([])
  expect(await projectPolicies(root)).toEqual([])
  await save(policy)
  expect(await projectPolicies(root)).toEqual([{ root, ...requirement }])
  await save({ ...policy, requirements: [{ ...requirement, cards: ['0001-task'] }] })
  expect(await projectPolicies(root)).toEqual([{ root, ...requirement, cards: ['0001-task'] }])
})
it.each([null, false, [], {}, { version: 2 }, { version: 1 }, { version: 1, requirements: {} }])('rejects malformed policy %j', async (value) => {
  await save(value); await expect(projectPolicies(root)).rejects.toThrow()
})
it.each([null, false, {}, { validators: [] }, { validators: [], edges: [] },
  { ...requirement, timeoutMs: '100' }, { ...requirement, timeoutMs: 1.5 }, { ...requirement, timeoutMs: 0 },
  { ...requirement, validators: {} }, { ...requirement, validators: [] }, { ...requirement, validators: [42] },
  { ...requirement, validators: [' '] }, { ...requirement, edges: [] }, { ...requirement, cards: [] }])('rejects malformed requirement %j', async (entry) => {
  await save({ version: 1, requirements: [entry] }); await expect(projectPolicies(root)).rejects.toThrow()
})
it('refuses linked roots, linked policies, directories, invalid JSON and oversized policy bytes', async () => {
  const alias = join(root, 'alias')
  await symlink(root, alias)
  await expect(projectPolicies(alias)).rejects.toThrow('root')
  const file = join(root, 'validation.json')
  await symlink(join(root, 'missing'), file)
  await expect(projectPolicies(root)).rejects.toThrow('policy file')
  await rm(file); await mkdir(file)
  await expect(projectPolicies(root)).rejects.toThrow('policy file')
  await rm(file, { recursive: true }); await writeFile(file, '{')
  await expect(projectPolicies(root)).rejects.toThrow()
  await writeFile(file, ' '.repeat(65_537))
  await expect(projectPolicies(root)).rejects.toThrow('size')
})
it.each([null, 'failure', {}, { code: 'EACCES' }])('propagates inspection failure instead of treating it as absence: %j', async (error) => {
  vi.mocked(lstat).mockRejectedValueOnce(error)
  await expect(projectPolicies(root)).rejects.toEqual(error)
  const stat = await lstat(root)
  vi.mocked(lstat).mockResolvedValueOnce(stat).mockRejectedValueOnce(error)
  await expect(projectPolicies(root)).rejects.toEqual(error)
})
it('refuses path retargeting and file replacement before reading bytes', async () => {
  await save(policy)
  vi.mocked(realpath).mockResolvedValueOnce(root).mockResolvedValueOnce(join(root, 'elsewhere'))
  await expect(projectPolicies(root)).rejects.toThrow('Aliased')
  const actualOpen = (await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises')).open
  for (const field of ['ino', 'dev', 'isFile'] as const) {
    vi.mocked(open).mockImplementationOnce(async (...args) => {
      const handle = await actualOpen(...args)
      const stat = await handle.stat()
      vi.spyOn(handle, 'stat').mockResolvedValueOnce(Object.assign(stat, { [field]: field === 'isFile' ? () => false : -1 }))
      return handle
    })
    await expect(projectPolicies(root)).rejects.toThrow('identity')
  }
})
