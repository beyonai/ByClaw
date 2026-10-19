import { lstat, realpath, stat } from 'node:fs/promises';
import path from 'node:path';

const SKILL_NAME = /^[a-z0-9][a-z0-9-]{0,62}$/;
const PROTECTED_SKILL = 'super-skill-manager';

function invalidName() {
  throw new TypeError('Invalid skill name. Use lowercase letters, digits, and hyphens only.');
}

export function validateSkillName(name) {
  if (typeof name !== 'string' || !SKILL_NAME.test(name) || path.isAbsolute(name) || path.win32.isAbsolute(name)) {
    invalidName();
  }
  return name;
}

export async function resolveManagedRoot(root) {
  if (typeof root !== 'string' || !root || /[\0*?{}$]/.test(root)) {
    throw new TypeError('Managed root must be a concrete directory path.');
  }
  let canonical;
  try {
    canonical = await realpath(root);
  } catch {
    throw new TypeError('Managed root must be an existing directory.');
  }
  if (!(await stat(canonical)).isDirectory()) throw new TypeError('Managed root must be a directory.');
  return canonical;
}

export function assertContained(root, target, { allowRoot = false } = {}) {
  const canonicalRoot = path.resolve(root);
  const candidate = path.resolve(target);
  const relative = path.relative(canonicalRoot, candidate);
  if ((!allowRoot && relative === '') || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) {
    throw new TypeError('Target is not contained by the managed root.');
  }
  return candidate;
}

export async function resolveSkillTarget(root, name, { allowMissing = true, allowProtectedRead = false } = {}) {
  validateSkillName(name);
  if (name === PROTECTED_SKILL && (allowProtectedRead !== true || allowMissing !== false)) {
    throw new TypeError('The protected super-skill-manager target cannot be changed.');
  }

  const canonicalRoot = await resolveManagedRoot(root);
  const candidate = path.join(canonicalRoot, name);
  assertContained(canonicalRoot, candidate);
  if (path.dirname(candidate) !== canonicalRoot) throw new TypeError('Skill target must be a direct child of the managed root.');

  try {
    const entry = await lstat(candidate);
    if (entry.isSymbolicLink()) throw new TypeError('Skill target must not be a symlink.');
    if (!entry.isDirectory()) throw new TypeError('Skill target must be a directory.');
    const canonicalTarget = await realpath(candidate);
    assertContained(canonicalRoot, canonicalTarget);
    if (path.dirname(canonicalTarget) !== canonicalRoot) throw new TypeError('Skill target must be a direct child of the managed root.');
    return canonicalTarget;
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
    if (!allowMissing) throw new TypeError('Skill target does not exist.');
    const canonicalParent = await realpath(path.dirname(candidate));
    assertContained(canonicalRoot, canonicalParent, { allowRoot: true });
    if (canonicalParent !== canonicalRoot) throw new TypeError('Skill target must be a direct child of the managed root.');
    return candidate;
  }
}
