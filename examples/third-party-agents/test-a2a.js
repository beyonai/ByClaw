#!/usr/bin/env node

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const FILE_PATH = process.env.FILE_PATH || path.join(__dirname, 'sales-report.md');
const PORT = Number(process.env.PORT || 3001);
const HOST = process.env.HOST || '0.0.0.0';
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 8);
const DELAY_MS = Number(process.env.DELAY_MS || 80);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeJson(res, statusCode, payload, extraHeaders = {}) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    ...extraHeaders,
  });
  res.end(JSON.stringify(payload));
}

function writeSse(res, payload) {
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildJsonRpcMessageResult(text, id) {
  return {
    jsonrpc: '2.0',
    id,
    result: {
      kind: 'message',
      messageId: `msg-${id}`,
      role: 'agent',
      parts: [
        {
          kind: 'text',
          text,
        },
      ],
    },
  };
}

function buildJsonRpcError(error, id) {
  return {
    jsonrpc: '2.0',
    id,
    error: {
      code: 500,
      message: error.message,
      data: {
        traceback: error.stack || error.message,
      },
    },
  };
}

function drainRequest(req) {
  return new Promise((resolve) => {
    req.on('data', () => {});
    req.on('end', resolve);
    req.on('error', resolve);
  });
}

async function streamFile(res) {
  const content = await fs.readFile(FILE_PATH, 'utf8');
  const chars = Array.from(content);
  let chunkId = 0;

  for (let index = 0; index < chars.length; index += CHUNK_SIZE) {
    const chunk = chars.slice(index, index + CHUNK_SIZE).join('');
    writeSse(res, buildJsonRpcMessageResult(chunk, `chunk-${chunkId}`));
    chunkId += 1;
    await sleep(DELAY_MS);
  }

  res.end();
}

async function handleA2a(req, res) {
  await drainRequest(req);

  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
    'Access-Control-Allow-Origin': '*',
  });
  res.flushHeaders?.();

  try {
    await streamFile(res);
  } catch (error) {
    writeSse(res, buildJsonRpcError(error, 'error'));
    res.end();
  }
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || `localhost:${PORT}`}`);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/card') {
    writeJson(res, 200, { url: `${url.origin}/a2a` });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/a2a') {
    await handleA2a(req, res);
    return;
  }

  writeJson(
    res,
    404,
    { error: 'Not found. Use GET /card or POST /a2a.' },
    { Allow: 'GET, POST, OPTIONS' },
  );
});

server.listen(PORT, HOST, () => {
  console.log(`A2A test API listening on http://${HOST}:${PORT}`);
  console.log(`Card endpoint: http://localhost:${PORT}/card`);
  console.log(`A2A endpoint: http://localhost:${PORT}/a2a`);
  console.log(`Streaming file: ${FILE_PATH}`);
});
