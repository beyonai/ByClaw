#!/usr/bin/env node
/** Tool-lease preparation; credentials come only from the existing process environment. */
import { readFile, readdir, writeFile } from 'node:fs/promises'
import { resolve, join, isAbsolute } from 'node:path'
import { pathToFileURL } from 'node:url'
import { load, dump } from 'js-yaml'
import { byClawSkillCacheDir, byClawSkillUrl, syncByClawSkill } from '../src/skill-sync.ts'

function fail(code) { throw new Error(`EXECUTION_SKILL_${code}`) }

function successful(body) {
  return body !== null && typeof body === 'object' && body.success !== false
    && (body.success === true || body.code === 0 || body.resultCode === 0)
}

function authentication(environment) {
  const user = environment.USER_CODE?.trim()
  const token = environment.BEYOND_TOKEN?.trim()
  if (!user || !token) fail('AUTH_MISSING')
  const headers = { 'content-type': 'application/json', language: 'zh-CN', 'X-User-Id': user, 'Beyond-Token': token }
  if (environment.SSO_TOKEN) headers['Sso-Token'] = environment.SSO_TOKEN
  if (environment.WHALE_AGENT_AUTHORIZATION) headers.WHALE_AGENT_AUTHORIZATION = environment.WHALE_AGENT_AUTHORIZATION
  return headers
}

async function definition(path, code) {
  const raw = (await readFile(path, 'utf8')).replace(/^\uFEFF/u, '')
  const match = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/u.exec(raw)
  const data = match === null ? {} : load(match[1])
  if (!data || typeof data !== 'object' || Array.isArray(data)) fail('INVALID_METADATA')
  let name = data.name ?? code
  // Match the existing Harness compatibility rule for code-v1.2 archive names.
  if (code && /^[a-z0-9]+(?:-[a-z0-9]+)*$/u.test(code) && typeof name === 'string'
    && name.startsWith(`${code}-`) && /^v?\d+(?:\.\d+)+(?:-[a-z0-9-]+)?$/u.test(name.slice(code.length + 1))) name = code
  const description = data.description ?? (code ? `ByClaw Skill ${code}` : undefined)
  if (typeof name !== 'string' || !/^[\p{L}\p{N}]+(?:[-_][\p{L}\p{N}]+)*$/u.test(name)
    || typeof description !== 'string' || !description.trim()) fail('INVALID_METADATA')
  for (const field of ['disable-model-invocation', 'user-invocable']) {
    if (data[field] !== undefined && typeof data[field] !== 'boolean') fail('INVALID_METADATA')
  }
  // Codex reads the file's metadata itself: a normalized link name alone is not enough.
  // Only adapt the downloaded cache; never rewrite image builtin source files.
  if (code && (data.name !== name || data.description === undefined)) {
    const body = match === null ? raw : raw.slice(match[0].length)
    await writeFile(path, `---\n${dump({ ...data, name, description })}---\n${body}`)
  }
  return { name, path, enabled: data['disable-model-invocation'] !== true }
}

/** Called under the runner's user-cache lock; does not expose other agents' cached Skills. */
export async function prepareAgentSkills({ agentId, byRoot, environment = process.env, fetchImpl = fetch }) {
  if (!/^\d+$/u.test(agentId)) fail('INVALID_AGENT_ID')
  if (typeof byRoot !== 'string' || !isAbsolute(byRoot)) fail('INVALID_WORKSPACE')
  const builtinRoot = environment.BYCLAW_SKILLS_DIR?.trim()
  if (!builtinRoot) fail('BUILTIN_MISSING')
  const baseUrl = (environment.BYAI_SERVICE_BASE_URL || environment.BYCLAW_DSH_BASE_URL || environment.WEB_BASE_URL)?.trim().replace(/\/+$/u, '')
  if (!baseUrl) fail('BASE_URL_MISSING')
  const headers = authentication(environment)
  const request = async (path, init = {}) => {
    let response
    try {
      response = await fetchImpl(byClawSkillUrl(baseUrl, path), {
        ...init, headers, redirect: 'manual', signal: AbortSignal.timeout(60_000),
      })
      if (response.status === 401 || response.status === 403) fail('AUTH_FAILED')
      if (!response.ok) fail('REQUEST_FAILED')
      const body = await response.json()
      if (!successful(body)) fail('REQUEST_FAILED')
      return body
    } catch (error) {
      if (/^EXECUTION_SKILL_[A-Z_]+$/u.test(error.message)) throw error
      fail('REQUEST_FAILED')
    }
  }
  const builtin = new Map()
  const builtinByCode = new Map()
  for (const entry of (await readdir(builtinRoot, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!entry.isDirectory() && !entry.isSymbolicLink()) continue
    const path = join(builtinRoot, entry.name, 'SKILL.md')
    try { await readFile(path) } catch (error) { if (error.code === 'ENOENT') continue; throw error }
    const skill = await definition(path)
    if (builtin.has(skill.name)) fail('NAME_CONFLICT')
    builtin.set(skill.name, skill)
    builtinByCode.set(entry.name, skill)
  }
  if (builtin.size === 0) fail('BUILTIN_MISSING')
  const body = await request(`${baseUrl}/digitalEmployeeController/queryRelResourceInfo`, {
    method: 'POST', body: JSON.stringify({ resourceId: agentId }),
  })
  if (!Array.isArray(body.data)) fail('INVALID_ASSOCIATIONS')
  const effective = new Map(builtin)
  const associated = new Map()
  const ids = new Set()
  for (const resource of body.data) {
    if (resource?.resourceBizType !== 'SKILL') continue
    const id = String(resource.resourceId ?? '')
    const code = resource.resourceCode
    if (!/^\d+$/u.test(id) || typeof code !== 'string') fail('INVALID_ASSOCIATIONS')
    if (ids.has(id)) continue
    ids.add(id)
    // An ID-specific cache prevents different resources sharing a code from aliasing.
    const cacheRoot = join(resolve(byRoot), '.byclaw', 'skills', id)
    byClawSkillCacheDir(cacheRoot, code)
    const versionUrl = `${baseUrl}/tool/getSkillVersion?skillId=${id}`
    const versionBody = await request(versionUrl)
    const version = versionBody.data
    if (!version || !['string', 'number'].includes(typeof version.version) || !String(version.version).trim()) fail('INVALID_VERSION')
    let skill
    if (version.skillType?.toLowerCase() === 'inner' || version.needDownload === false) {
      skill = builtinByCode.get(code) ?? builtin.get(code)
      if (!skill) fail('BUILTIN_MISSING')
    } else {
      const path = await syncByClawSkill({
        ref: { id, code, type: 'hub', versionUrl, downloadUrl: `${baseUrl}/tool/downloadSkillZip?skillId=${id}` },
        baseUrl, headers, cacheRoot,
        // Reuse the already validated version response; ZIPs use the same existing downloader.
        fetchImpl: async (url, init) => String(url) === versionUrl
          ? Response.json(versionBody) : fetchImpl(url, init),
      })
      skill = await definition(join(path, 'SKILL.md'), code)
    }
    if (associated.has(skill.name)) fail('NAME_CONFLICT')
    associated.set(skill.name, skill)
    effective.set(skill.name, skill)
  }
  return [...effective.values()].sort((a, b) => a.name.localeCompare(b.name))
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const skills = await prepareAgentSkills({ agentId: process.argv[2] ?? '', byRoot: process.argv[3] ?? '' })
    process.stdout.write(`${JSON.stringify({ skills })}\n`)
  } catch (error) {
    // Never print auth headers, private download URLs or arbitrary HTTP exception text.
    process.stderr.write(`${/^EXECUTION_SKILL_[A-Z_]+$/u.test(error.message) ? error.message : 'EXECUTION_SKILL_PREPARE_FAILED'}\n`)
    process.exitCode = 1
  }
}
