import fs from 'node:fs';
import path from 'node:path';
import { fail, regularJson, routeDirectory, routePlans } from './plan-store.mjs';

// Call only under the route lock. One strict mail budget for the parent task;
// a different account, operation or attempt never resets its clock or counters.
export function taskBudget(paths, request, proposedDeadline) {
  if (request.channel !== 'mail') return null;
  const file = path.join(routeDirectory(paths), 'mail-budget.json');
  if (!fs.existsSync(file)) fs.writeFileSync(file, JSON.stringify({ ...request.budget, deadlineAt: proposedDeadline }), { flag: 'wx', mode: 0o600 });
  return regularJson(file);
}
export function allocateBudget(paths, plan) {
  if (plan.request.channel !== 'mail') return null;
  const budget = taskBudget(paths, plan.request, plan.deadlineAt);
  const used = routePlans(paths).filter(p => p.request.channel === 'mail' && p.result)
    .reduce((sum, p) => sum + (p.result.usage?.scannedItems ?? p.allocatedBudget?.maxScannedItems ?? 0), 0);
  const remaining = budget.maxScannedItems - used;
  if (remaining <= 0) fail('SCAN_BUDGET_EXHAUSTED');
  return { ...plan.request.budget, maxScannedItems: Math.min(remaining, plan.request.budget.maxScannedItems),
    maxReturnedItems: Math.min(budget.maxReturnedItems, plan.request.budget.maxReturnedItems),
    maxDownloadedBytes: Math.min(budget.maxDownloadedBytes, plan.request.budget.maxDownloadedBytes) };
}
