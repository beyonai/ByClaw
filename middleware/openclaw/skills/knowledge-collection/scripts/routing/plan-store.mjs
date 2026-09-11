import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

export const fail = code => { throw Object.assign(new Error(code), { code }); };
export function canonical(value) {
  if (Array.isArray(value)) return value.map(canonical);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])]));
  return value;
}
export const fingerprint = value => crypto.createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function regularJson(file, maxBytes = 32 * 1024 * 1024) {
  const stat = fs.lstatSync(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > maxBytes) fail('UNSAFE_ROUTE_PATH');
  return JSON.parse(fs.readFileSync(file, 'utf8'));
}
export function loadSession(paths, { allowUncommitted = false } = {}) {
  const entry = fs.lstatSync(paths.root);
  if (!entry.isDirectory() || entry.isSymbolicLink()) fail('UNSAFE_ROUTE_PATH');
  const session = regularJson(paths.session);
  if (session.schemaVersion !== '2.0' || !session.task) fail('ROUTE_REQUIRES_CURRENT_SESSION');
  if (!allowUncommitted && session.task.publicationStatus === 'uncommitted') fail('SESSION_NOT_COMMITTED');
  return session;
}
export function contextFingerprint(session) {
  const task = session.task;
  return fingerprint(Object.fromEntries(['query', 'sourceScope', 'mailBindings', 'workflow', 'materializationTarget',
    'requiredContentGranularity', 'cloudDiscoveryScope', 'deliveryRequested', 'deliveryTarget', 'startedAt',
    'deadlineMinutes', 'concurrency'].map(key => [key, task[key] ?? null])));
}
export function routeDirectory(paths, create = false) {
  loadSession(paths, { allowUncommitted: true });
  const dir = path.join(paths.root, '.routing');
  if (create && !fs.existsSync(dir)) fs.mkdirSync(dir, { mode: 0o700 });
  if (fs.existsSync(dir)) {
    const entry = fs.lstatSync(dir);
    if (!entry.isDirectory() || entry.isSymbolicLink() || (entry.mode & 0o077)
      || (process.getuid && entry.uid !== process.getuid())) fail('UNSAFE_ROUTE_PATH');
  }
  return dir;
}
export function planPath(paths, planId) {
  if (!/^[a-f0-9]{64}$/.test(planId || '')) fail('INVALID_PLAN_ID');
  return path.join(routeDirectory(paths), `${planId}.json`);
}
export function readPlan(paths, planId) {
  const plan = regularJson(planPath(paths, planId));
  if (plan.planId !== planId || plan.routeContractVersion !== 1) fail('INVALID_PLAN');
  return plan;
}
export function writePlan(paths, plan) {
  const destination = planPath(paths, plan.planId);
  if (fs.existsSync(destination)) regularJson(destination);
  const temp = `${destination}.${crypto.randomUUID()}.tmp`;
  fs.writeFileSync(temp, `${JSON.stringify(plan)}\n`, { flag: 'wx', mode: 0o600 });
  try { fs.renameSync(temp, destination); } finally { fs.rmSync(temp, { force: true }); }
}
export function withRouteLock(paths, fn) {
  const dir = routeDirectory(paths, true);
  const lock = path.join(dir, '.lock');
  if (fs.existsSync(lock)) {
    const entry = fs.lstatSync(lock);
    if (!entry.isDirectory() || entry.isSymbolicLink()) fail('UNSAFE_ROUTE_PATH');
    try {
      const owner = regularJson(path.join(lock, 'owner.json'));
      if (Number.isSafeInteger(owner.pid) && owner.pid > 0) {
        try { process.kill(owner.pid, 0); }
        catch (error) {
          if (error.code === 'ESRCH' && fs.lstatSync(lock).ino === entry.ino) {
            fs.unlinkSync(path.join(lock, 'owner.json'));
            fs.rmdirSync(lock);
          }
        }
      }
    } catch { /* An unknown lock owner requires operator investigation. */ }
  }
  try { fs.mkdirSync(lock, { mode: 0o700 }); } catch { fail('ROUTE_BUSY'); }
  const ownerFile = path.join(lock, 'owner.json');
  try {
    fs.writeFileSync(ownerFile, JSON.stringify({ pid: process.pid }), { flag: 'wx', mode: 0o600 });
    return fn();
  } finally { fs.rmSync(ownerFile, { force: true }); fs.rmdirSync(lock); }
}
export function routePlans(paths) {
  const dir = routeDirectory(paths);
  if (!fs.existsSync(dir)) return [];
  return fs.readdirSync(dir).filter(n => /^[a-f0-9]{64}\.json$/.test(n)).map(n => readPlan(paths, n.slice(0, -5)));
}

export function assertNoActiveRoute(paths) {
  if (!fs.existsSync(path.join(paths.root, '.routing'))) return;
  if (routePlans(paths).some(p => ['running', 'interrupted'].includes(p.state))) fail('SESSION_EXECUTION_ACTIVE');
}
