import fs from 'node:fs';
import path from 'node:path';
import { sessionPaths, resolveSandboxPath } from '../session.mjs';
import { evaluateRoute, resolveRoute, dispatchRoute, routeStatus } from './dispatcher.mjs';
import { fail, loadSession, readPlan } from './plan-store.mjs';

export function parseRequestJson(text) {
  if (Buffer.byteLength(text) > 1024 * 1024) fail('INVALID_REQUEST');
  const value = JSON.parse(text);
  // JSON.parse accepts duplicate keys; routing inputs deliberately do not.
  const tokens = text.match(/"(?:[^"\\]|\\.)*"|[{}\[\]:,]|[^\s{}\[\]:,]+/g) || [];
  const stack = [];
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '{' || token === '[') stack.push(token === '{' ? new Set() : null);
    else if (token === '}' || token === ']') stack.pop();
    else if (token.startsWith('"') && tokens[i + 1] === ':') {
      const key = JSON.parse(token), seen = stack.at(-1);
      if (!seen || seen.has(key)) fail('DUPLICATE_REQUEST_KEY');
      seen.add(key);
    }
    if (stack.length > 32) fail('INVALID_REQUEST');
  }
  return value;
}

function readRequest(paths, name) {
  if (typeof name !== 'string') fail('INVALID_REQUEST');
  const target = path.resolve(paths.root, name);
  const inputRoot = path.join(paths.root, '.collection-inputs');
  if (!target.startsWith(`${inputRoot}${path.sep}`)) fail('UNSAFE_REQUEST_PATH');
  let current = paths.root;
  for (const part of path.relative(paths.root, target).split(path.sep)) {
    current = path.join(current, part);
    if (fs.lstatSync(current).isSymbolicLink()) fail('UNSAFE_REQUEST_PATH');
  }
  const stat = fs.lstatSync(target);
  if (!stat.isFile() || stat.size > 1024 * 1024) fail('INVALID_REQUEST');
  return parseRequestJson(fs.readFileSync(target, 'utf8'));
}

export async function executeRouteCommand(command, args) {
  const paths = sessionPaths(resolveSandboxPath(args['session-dir'], '--session-dir', {
    currentSessionRoot: args['session-root'],
  }));
  if (command === 'route-status') return routeStatus(paths, args['plan-id']);
  if (command === 'route-dispatch') return dispatchRoute(paths, args['plan-id']);
  const request = readRequest(paths, args['request-file']);
  if (command === 'route-evaluate') return evaluateRoute(request, loadSession(paths));
  if (command === 'route-resolve') return resolveRoute(paths, request);
  fail('UNKNOWN_ROUTE_COMMAND');
}
