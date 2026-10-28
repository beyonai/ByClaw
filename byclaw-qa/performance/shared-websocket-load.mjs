import fs from 'node:fs';
import { pathToFileURL } from 'node:url';
import { randomUUID } from 'node:crypto';

export function decodeMessage(raw) {
  const envelope = JSON.parse(String(raw));
  let data = envelope.data || {};
  if (typeof data === 'string') {
    try { data = JSON.parse(data); } catch { data = {}; }
  }
  return { envelope, data, event: envelope.event || data.event || envelope.type };
}

export function matchesRequest(message, requestId, sessionId) {
  const { envelope: e, data: d } = message;
  const ids = [e.clientRequestId, d.clientRequestId].filter(Boolean);
  if (ids.length) return ids.includes(requestId);
  return sessionId != null && [e.sessionId, d.sessionId].some((id) => id != null && String(id) === String(sessionId));
}

export function percentile(values, p) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  return sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * p) - 1)] : null;
}

export function summarize(rows) {
  const result = {};
  for (const scenario of new Set(rows.map((r) => r.scenario))) {
    const group = rows.filter((r) => r.scenario === scenario);
    result[scenario] = { total: group.length, passed: group.filter((r) => r.status === 'passed').length };
    for (const metric of ['firstAnswerMs', 'elapsedMs']) {
      const values = group.filter((r) => r.status === 'passed').map((r) => r[metric]);
      result[scenario][metric] = { p50: percentile(values, 0.5), p95: percentile(values, 0.95), max: percentile(values, 1) };
    }
  }
  return result;
}

async function connect(user, endpoint, timeoutMs) {
  const url = new URL(endpoint);
  url.searchParams.set('beyond-token', user.token);
  url.searchParams.set('language', 'zh-CN');
  url.searchParams.set('scoped-delta-version', '1');
  const start = performance.now();
  const socket = new WebSocket(url);
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => { socket.close(); reject(new Error('WebSocket connection timed out')); }, timeoutMs);
    socket.onopen = () => { clearTimeout(timeout); resolve(); };
    socket.onerror = () => { clearTimeout(timeout); reject(new Error('WebSocket connection failed')); };
    socket.onclose = () => { clearTimeout(timeout); reject(new Error('WebSocket closed during handshake')); };
  });
  const heartbeat = setInterval(() => {
    if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'NOTIFICATION' }));
  }, 6000);
  return { user, socket, heartbeat, connectMs: performance.now() - start, sessionId: null };
}

async function chat(client, scenario, runId, index, output, timeoutMs, followup) {
  const requestId = `${runId}-${scenario}-${index}`;
  const marker = `LOAD_${index}_${randomUUID().slice(0, 8)}`;
  const start = performance.now();
  const row = { userIndex: index, requestId, scenario, marker, sentEpochMs: Date.now(), connectMs: client.connectMs, sessionId: followup ? client.sessionId : null, status: 'pending', events: [] };
  return new Promise((resolve) => {
    let done = false;
    const finish = (status) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      row.status = status;
      row.elapsedMs = Math.round(performance.now() - start);
      client.socket.removeEventListener('message', onMessage);
      client.socket.removeEventListener('close', onClose);
      client.socket.removeEventListener('error', onError);
      fs.appendFileSync(`${output}/results.jsonl`, JSON.stringify(row) + '\n', { mode: 0o600 });
      console.log(JSON.stringify({ scenario, userIndex: index, status, firstAnswerMs: row.firstAnswerMs, elapsedMs: row.elapsedMs }));
      resolve(row);
    };
    const onClose = () => finish('ws_closed');
    const onError = () => finish('ws_error');
    const onMessage = (event) => {
      let m;
      try { m = decodeMessage(event.data); } catch { return; }
      if (!matchesRequest(m, requestId, row.sessionId)) return;
      const elapsed = Math.round(performance.now() - start);
      if (!row.events.some((e) => e.event === m.event)) row.events.push({ event: m.event, ms: elapsed });
      if (m.event === 'createSession' && m.data.sessionId != null) {
        row.sessionId = String(m.data.sessionId);
        client.sessionId = row.sessionId;
      }
      if (m.event === 'initialization') row.traceId = m.data.traceId;
      if (m.event === 'answerDelta' && row.firstAnswerMs == null) row.firstAnswerMs = elapsed;
      if (m.event === 'finalAnswer') {
        row.answer = m.data.final_content ?? '';
        row.firstAnswerMs ??= elapsed;
        finish(typeof row.answer === 'string' && row.answer.includes(marker) && !/LOAD_\d+_[a-f0-9]{8}/g.test(row.answer.replaceAll(marker, '')) ? 'passed' : 'answer_mismatch');
      } else if (String(m.event).toLowerCase() === 'error') {
        // Error content may contain credentials or internal response bodies; retain only its code.
        row.errorCode = m.data.code ?? m.envelope.code;
        finish('server_error');
      }
    };
    const timer = setTimeout(() => finish('timeout'), timeoutMs);
    client.socket.addEventListener('message', onMessage);
    client.socket.addEventListener('close', onClose);
    client.socket.addEventListener('error', onError);
    if (client.socket.readyState !== WebSocket.OPEN) return finish('ws_closed');
    client.socket.send(JSON.stringify({ type: 'LLM_MESSAGE', clientRequestId: requestId, language: 'zh-CN', chatContent: `这是并发聊天只读验证。不要调用工具或委派，不要操作任何数据。只回复本条消息的校验码：${marker}`, relModelId: -1, accessTerminal: 'Web', sessionId: row.sessionId, chatId: row.sessionId, sessionType: 'H_AS', extParams: { requestId } }));
  });
}

export async function main() {
  const [credentials, output, endpoint = 'ws://127.0.0.1:28082/byaiService/ws'] = process.argv.slice(2);
  if (!credentials || !output) throw new Error('Usage: node shared-websocket-load.mjs <private-users.json> <new-output-directory> [ws-url]');
  const users = JSON.parse(fs.readFileSync(credentials, 'utf8'));
  if (users.length !== 10 || new Set(users.map((u) => u.id)).size !== 10 || users.some((u) => !u.token)) throw new Error('Exactly 10 distinct authenticated users are required');
  fs.mkdirSync(output, { mode: 0o700 });
  const runId = `load10-${Date.now()}`;
  const timeoutMs = 240000;
  const clients = [];
  const rows = [];
  try {
    const opened = await Promise.allSettled(users.map(async (u) => {
      const client = await connect(u, endpoint, 30000); clients.push(client); return client;
    }));
    if (opened.some((r) => r.status === 'rejected')) throw new Error('Some WebSocket connections failed; chat load was not started');
    const ordered = opened.map((r) => r.value);
    fs.writeFileSync(`${output}/run.json`, JSON.stringify({ runId, startedAt: new Date().toISOString(), concurrency: 10, rounds: 4, connectionMs: ordered.map((c) => c.connectMs) }, null, 2));
    for (const scenario of ['first-new-session', 'warm-new-session', 'same-session-followup', 'warm-new-session-2']) {
      const result = await Promise.all(ordered.map((c, i) => chat(c, scenario, runId, i, output, timeoutMs, scenario === 'same-session-followup')));
      rows.push(...result);
      fs.writeFileSync(`${output}/summary.json`, JSON.stringify(summarize(rows), null, 2));
      // Do not amplify a broken deployment or send followups into failed sessions.
      if (result.some((r) => r.status !== 'passed')) break;
      await new Promise((resolve) => setTimeout(resolve, 3000));
    }
  } finally {
    for (const c of clients) { clearInterval(c.heartbeat); c.socket.close(); }
  }
  console.log(JSON.stringify(summarize(rows)));
  if (rows.length !== 40 || rows.some((r) => r.status !== 'passed')) process.exitCode = 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(() => { console.error('Load run failed. Check protected diagnostics; credentials are not logged.'); process.exitCode = 1; });
}
