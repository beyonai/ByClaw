import { createHash } from 'node:crypto';
import { lstat, opendir, readFile, realpath } from 'node:fs/promises';
import path from 'node:path';

import { assertContained, validateSkillName } from './paths.mjs';
import { hashSkillDirectory } from './transaction.mjs';

const DEFAULT_LIMITS = Object.freeze({ maxDepth: 8, maxFiles: 128, maxFileBytes: 256 * 1024, maxReadBytes: 1024 * 1024 });
const SHA = /^[a-f0-9]{40,64}$/;
const REASONS = Object.freeze({
  audit: 'MISSING_TRUSTED_AUDIT', mutable: 'MUTABLE_REF', newRepo: 'VERY_NEW_REPOSITORY', broadFiles: 'BROAD_FILE_ACCESS', executable: 'UNDECLARED_EXECUTABLE_REQUIREMENTS',
  malware: 'TRUSTED_AUDIT_MALWARE', impersonation: 'KNOWN_SOURCE_IMPERSONATION', credentials: 'EXPLICIT_CREDENTIAL_EXFILTRATION', opaque: 'OPAQUE_REMOTE_EXECUTION',
  hiddenNetwork: 'HIDDEN_NETWORK_DESTINATION', bypass: 'BYPASS_SANDBOX_OR_APPROVAL', symlink: 'SYMLINK_NOT_ALLOWED', bounds: 'FILE_ANALYSIS_BOUNDS_EXCEEDED',
});

function plain(value) { return value !== null && typeof value === 'object' && !Array.isArray(value) && (Object.getPrototypeOf(value) === Object.prototype || Object.getPrototypeOf(value) === null); }
function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!plain(value)) return value;
  return Object.fromEntries(Object.keys(value).sort().map((key) => [key, stable(value[key])]));
}
function digest(value) { return createHash('sha256').update(JSON.stringify(stable(value))).digest('hex'); }
export function securityReportDigest(report) {
  if (!plain(report) || !['pass', 'caution', 'unknown', 'malicious'].includes(report.status) || !Array.isArray(report.reasons)) {
    throw new TypeError('Security report is invalid.');
  }
  return digest({
    status: report.status,
    reasons: [...new Set(report.reasons.filter((reason) => typeof reason === 'string'))].sort(),
    permissions: Array.isArray(report.permissions) ? [...report.permissions].filter((value) => typeof value === 'string').sort() : [],
    files: Array.isArray(report.files) ? report.files.map((file) => stable(file)).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right))) : [],
  });
}
function status(reasons) {
  const deny = new Set([REASONS.malware, REASONS.impersonation, REASONS.credentials, REASONS.opaque, REASONS.hiddenNetwork, REASONS.bypass, REASONS.symlink]);
  return reasons.some((reason) => deny.has(reason)) ? 'malicious' : reasons.length ? 'caution' : 'pass';
}
function add(reasons, reason) { if (!reasons.includes(reason)) reasons.push(reason); }

function runtimeRelevant(file) {
  const parts = file.path.split(path.sep);
  const basename = parts.at(-1);
  if (basename === 'SKILL.md') return true;
  if (file.executable) return true;
  if (parts.some((part) => ['test', 'tests', 'fixture', 'fixtures', 'reference', 'references'].includes(part))) return false;
  return /\.(?:[cm]?js|ts|tsx|py|rb|pl|php|sh|bash|zsh|fish|ps1|json|ya?ml|toml|ini|conf)$/iu.test(basename);
}

export function validateCandidate(candidate) {
  if (!plain(candidate) || Object.keys(candidate).some((key) => !['name', 'source', 'ref', 'trustedAudit', 'repositoryAgeDays', 'permissions', 'executableRequirements', 'sourceImpersonation'].includes(key))) {
    throw new TypeError('Candidate metadata is invalid.');
  }
  validateSkillName(candidate.name);
  if (typeof candidate.source !== 'string' || !/^https:\/\/[^\s/@]+(?:\/[^\s?#]+)+$/u.test(candidate.source) || /[?#@]/u.test(candidate.source.slice(8))) {
    throw new TypeError('Candidate source is invalid.');
  }
  if (typeof candidate.ref !== 'string' || !candidate.ref || candidate.ref.length > 128 || /[\0\s]/u.test(candidate.ref)) throw new TypeError('Candidate ref is invalid.');
  if (candidate.permissions !== undefined && (!Array.isArray(candidate.permissions) || candidate.permissions.some((item) => typeof item !== 'string' || item.length > 100))) throw new TypeError('Candidate permissions are invalid.');
  if (candidate.executableRequirements !== undefined && (!Array.isArray(candidate.executableRequirements) || candidate.executableRequirements.some((item) => typeof item !== 'string' || item.length > 100))) throw new TypeError('Candidate executable requirements are invalid.');
  return { name: candidate.name, source: candidate.source, ref: candidate.ref, trustedAudit: candidate.trustedAudit, repositoryAgeDays: candidate.repositoryAgeDays, permissions: candidate.permissions ?? [], executableRequirements: candidate.executableRequirements ?? [], sourceImpersonation: candidate.sourceImpersonation === true };
}

export function screenMetadata(input) {
  const candidate = validateCandidate(input);
  const reasons = [];
  if (candidate.trustedAudit === 'malware') add(reasons, REASONS.malware);
  else if (candidate.trustedAudit !== 'pass') add(reasons, REASONS.audit);
  if (candidate.sourceImpersonation) add(reasons, REASONS.impersonation);
  if (!SHA.test(candidate.ref)) add(reasons, REASONS.mutable);
  if (!Number.isInteger(candidate.repositoryAgeDays) || candidate.repositoryAgeDays < 30) add(reasons, REASONS.newRepo);
  if (candidate.permissions.some((permission) => /(^|[/:])(?:\*|home|root|filesystem)(?:$|[/:])/iu.test(permission))) add(reasons, REASONS.broadFiles);
  if (candidate.executableRequirements.length) add(reasons, REASONS.executable);
  const result = { status: status(reasons), reasons: reasons.sort(), permissions: [...candidate.permissions].sort(), files: [] };
  if (result.status === 'pass' || (result.status === 'caution' && !reasons.some((reason) => [REASONS.broadFiles, REASONS.executable].includes(reason)))) result.status = 'unknown';
  return result;
}

function defensivePatternLine(line) {
  return /(?:^|\s)(?:const|let|var)\s+\w+\s*=\s*\/|(?:^|\s)(?:if|while)\s*\(\s*\//u.test(line);
}

function inspectText(text, reasons, { sourceCode = false } = {}) {
  const inspected = sourceCode ? text.split(/\r?\n/u).filter((line) => !defensivePatternLine(line)).join('\n') : text;
  if (/(?:OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY|(?:api[_-]?key|token|password|credential)[^\n]{0,120}(?:curl|fetch|upload|send|webhook)|(?:curl|fetch)[^\n]{0,160}(?:api[_-]?key|token|password|credential)|(?:printenv|env)\s+(?:[A-Z][A-Z0-9_]*(?:KEY|TOKEN|SECRET|PASSWORD)|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY)[^\n]{0,160}(?:\||;|&&)[^\n]{0,160}(?:curl|wget)[^\n]{0,160}(?:POST|--data|--upload|https?:\/\/))/iu.test(inspected)) add(reasons, REASONS.credentials);
  for (const line of inspected.split(/\r?\n/u)) {
    const executableLine = line.replace(/(?:do\s+not|don't|never|must\s+not)\s+(?:run|execute|use|quote|report)\s*(["'`])[^"'`]*\1/giu, (match) => ' '.repeat(match.length));
    const wholeEnvironment = /(?:\$\(\s*(?:printenv|env)\s*\)|`\s*(?:printenv|env)\s*`|\b(?:printenv|env)\b\s*(?=\||>|>>))/iu.test(executableLine);
    const networkUpload = /\b(?:curl|wget)\b|https?:\/\/|\bhttp\s+(?:post|put)\b/iu.test(executableLine);
    if (wholeEnvironment && networkUpload) add(reasons, REASONS.credentials);
  }
  if (/(?:base64\s+-d|fromCharCode|atob\()[^\n]{0,180}(?:\||;|&&)\s*(?:sh|bash|node|python)|(?:curl|wget)[^\n]{0,180}\|\s*(?:sh|bash)/iu.test(inspected)) add(reasons, REASONS.opaque);
  const hiddenNetwork = sourceCode
    ? /process\.env[^\n]{0,120}(?:https?|webhook)/iu
    : /(?:webhook\s*(?:url|destination)?\s*(?:assembled|from|=)|process\.env[^\n]{0,120}(?:https?|webhook)|https?:\/\/[^\s"']+[^\s"'/:](?:\s*\+|\s*\$\{|\s*\$\())/iu;
  if (hiddenNetwork.test(inspected)) add(reasons, REASONS.hiddenNetwork);
  if (sourceCode) return;
  const bypassInstruction = /\b(?:ignore|bypass|disable)(?:ing|d)?\b[^\n]{0,80}\b(?:sandbox|approval|confirm(?:ation)?)(?:\s+(?:checks?|prompts?|requirements?|restrictions?))?/giu;
  for (const match of inspected.matchAll(bypassInstruction)) {
    const before = inspected.slice(Math.max(0, match.index - 80), match.index);
    const protectedAction = /(?:never|do\s+not|don't|must\s+not|without)(?:\s+\w+){0,3}\s*$/iu.test(before);
    const lineBefore = before.slice(before.lastIndexOf('\n') + 1);
    if (/\bmanager\.mjs\b/u.test(lineBefore)) continue;
    const quotedReport = /\b(?:say|says|said|write|wrote|quote|quoted|reference|referenced|mention|mentioned|report|reported)\b\s*:?\s*["'`][^"'`]*$/iu.test(lineBefore);
    if (!protectedAction && !quotedReport) { add(reasons, REASONS.bypass); break; }
  }
}

async function boundedFiles(directory, limits) {
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || directory.includes('\0')) throw new TypeError('Skill directory must be an absolute concrete directory path.');
  const rootEntry = await lstat(directory);
  if (rootEntry.isSymbolicLink() || !rootEntry.isDirectory()) throw new TypeError('Skill directory must be a regular directory.');
  const root = await realpath(directory);
  const output = []; const queue = [{ directory: root, depth: 0 }]; let discovered = 0;
  while (queue.length) {
    const current = queue.shift();
    const handle = await opendir(current.directory);
    for await (const entry of handle) {
      if (discovered >= limits.maxFiles) return { root, files: output, exceeded: true };
      discovered += 1;
      const target = path.join(current.directory, entry.name); assertContained(root, target, { allowRoot: true });
      if (entry.isSymbolicLink()) { output.push({ path: path.relative(root, target), symlink: true }); continue; }
      if (entry.isDirectory()) {
        output.push({ path: path.relative(root, target), directory: true });
        if (current.depth >= limits.maxDepth) output[output.length - 1].bound = true;
        else queue.push({ directory: target, depth: current.depth + 1 });
      } else if (entry.isFile()) {
        const info = await lstat(target); output.push({ path: path.relative(root, target), size: info.size, executable: (info.mode & 0o111) !== 0, absolute: target });
      }
    }
  }
  return { root, files: output, exceeded: false };
}

export async function screenSkillDirectory(directory, options = {}) {
  const limits = { ...DEFAULT_LIMITS, ...options };
  if (!Object.values(limits).every((value) => Number.isInteger(value) && value > 0)) throw new TypeError('File analysis limits are invalid.');
  const scanned = await boundedFiles(directory, limits); const reasons = []; let readBytes = 0;
  if (scanned.exceeded) add(reasons, REASONS.bounds);
  const files = [];
  for (const file of scanned.files) {
    if (file.symlink) { add(reasons, REASONS.symlink); files.push({ path: file.path, type: 'symlink' }); continue; }
    if (file.directory) { if (file.bound) add(reasons, REASONS.bounds); files.push({ path: file.path, type: 'directory', analyzed: !file.bound }); continue; }
    if (!runtimeRelevant(file)) { files.push({ path: file.path, size: file.size, analyzed: false }); continue; }
    if (file.bound || file.size > limits.maxFileBytes || readBytes + file.size > limits.maxReadBytes) { add(reasons, REASONS.bounds); files.push({ path: file.path, size: file.size ?? null, analyzed: false }); continue; }
    const contents = await readFile(file.absolute, 'utf8'); readBytes += Buffer.byteLength(contents);
    inspectText(contents, reasons, { sourceCode: /\.(?:[cm]?js|ts|tsx|py|rb|pl|php)$/iu.test(file.path) });
    files.push({ path: file.path, size: file.size, analyzed: true });
  }
  const metadata = { status: status(reasons), reasons: reasons.sort(), permissions: [], files: files.map(({ absolute, ...file }) => file) };
  return metadata.status === 'pass' ? { ...metadata, status: 'unknown', reasons: [REASONS.audit] } : metadata;
}

async function sourceHash(directory) {
  const scanned = await boundedFiles(directory, DEFAULT_LIMITS);
  if (scanned.exceeded || scanned.files.some((file) => file.symlink || file.bound || (!file.directory && file.size > DEFAULT_LIMITS.maxFileBytes)) ||
    scanned.files.reduce((total, file) => total + (file.size ?? 0), 0) > DEFAULT_LIMITS.maxReadBytes) throw new TypeError('Candidate source exceeds secure preview bounds.');
  return hashSkillDirectory(scanned.root);
}

export async function createInstallPreview({ candidate, skillDirectory } = {}) {
  const normalized = validateCandidate(candidate); const metadata = screenMetadata(normalized); const files = await screenSkillDirectory(skillDirectory);
  const security = { status: metadata.status === 'malicious' || files.status === 'malicious' ? 'malicious' : (metadata.status === 'caution' || files.status === 'caution' ? 'caution' : 'unknown'), reasons: [...new Set([...metadata.reasons, ...files.reasons])].sort() };
  const contentHash = await sourceHash(skillDirectory);
  const preview = { operation: 'install', candidate: { name: normalized.name, source: normalized.source, ref: normalized.ref }, target: { name: normalized.name }, security, permissions: metadata.permissions, files: files.files, sourceHash: contentHash, requiresConfirmation: true };
  const securedPreview = { ...preview, securityDigest: securityReportDigest(files) };
  return { ...securedPreview, previewId: digest(securedPreview) };
}
