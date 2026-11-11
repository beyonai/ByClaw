#!/usr/bin/env node
/** Patch the pinned, compiled SSH helper before A computes B's helper digest. */
import { readFile, realpath, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

export const before = 'const env = request.env === void 0 ? {} : Object.fromEntries(Object.entries(request.env).map(([key, value]) => [key, value ?? void 0]));'
export const after = `${before}
		// Only the tool-sandbox sshd enables forwarding; A still filters host credentials.
		if (process.env.BYCLAW_TOOL_ENV_FORWARDING === "1") {
			const raw = process.env.BYCLAW_TOOL_ENV_FORWARD_ENVIRONMENT ?? "all";
			let policy;
			try { policy = raw === "all" ? "all" : JSON.parse(raw); }
			catch { throw new Error("Invalid tool sandbox environment forwarding policy"); }
			if (policy !== "all" && (typeof policy !== "object" || policy === null || Array.isArray(policy) || Object.keys(policy).length !== 1 || !Array.isArray(policy.allow) || !policy.allow.every(name => typeof name === "string" && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name)))) throw new Error("Invalid tool sandbox environment forwarding policy");
			const internal = /^(?:BYCLAW_(?:DSH_)?TOOL_ENV(?:_|$)|BYCLAW_BROWSER_(?:SECRET(?:_|$)|LISTEN_FD$)|BYCLAW_MICROVM_PAYLOAD$|BYCLAW_COMMAND_PAYLOAD$)/;
			const allowed = policy === "all" ? null : new Set(policy.allow);
			for (const [name, value] of Object.entries(process.env)) {
				if (value !== void 0 && /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) && !internal.test(name) && (allowed === null || allowed.has(name)) && !Object.hasOwn(env, name)) Object.defineProperty(env, name, { value, enumerable: true, writable: true, configurable: true });
			}
			// Explicit values (including null tombstones) win, except internal launch inputs.
			for (const name of Object.keys(env)) if (internal.test(name)) delete env[name];
		}`

export function prepareSource(source) {
  if (source.split(after).length === 2 && !source.replace(after, '').includes(before)) return source
  if ((source.includes('BYCLAW_TOOL_ENV_FORWARDING') || source.includes('BYCLAW_TOOL_ENV_OWN_REDIS_PASSWORD')) || source.split(before).length !== 2) {
    throw new Error('Unsupported DSH SSH helper environment source')
  }
  return source.replace(before, after)
}

export async function prepare(workspace, profile) {
  // Resolve both installed copies first; validate all inputs before writing any.
  const files = [...new Set(await Promise.all([
    resolve(workspace, 'packages/ssh/ssh/lib/helper.js'),
    resolve(profile, 'node_modules/@deepseek-ai/dsh-ssh/lib/helper.js'),
  ].map(path => realpath(path))))]
  const edits = await Promise.all(files.map(async path => {
    const manifest = JSON.parse(await readFile(resolve(path, '../../package.json'), 'utf8'))
    if (manifest.name !== '@deepseek-ai/dsh-ssh' || manifest.version !== '0.2.1-rc.2') {
      throw new Error('Expected @deepseek-ai/dsh-ssh 0.2.1-rc.2')
    }
    return [path, prepareSource(await readFile(path, 'utf8'))]
  }))
  if (new Set(edits.map(([, source]) => source)).size !== 1) throw new Error('SSH helper copies differ')
  for (const [path, source] of edits) await writeFile(path, source)
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv.length !== 4) throw new Error('Usage: prepare-tool-helper-env.mjs <workspace> <profile>')
  await prepare(process.argv[2], process.argv[3])
}
