#!/usr/bin/env node

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const FILE_PATH = process.env.FILE_PATH || path.join(__dirname, 'sales-report.md');
const PORT = Number(process.env.PORT || 3003);
const HOST = process.env.HOST || '0.0.0.0';
const CHUNK_SIZE = Number(process.env.CHUNK_SIZE || 8);
const DELAY_MS = Number(process.env.DELAY_MS || 80);

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function writeSse(res, event, payload) {
  res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function buildAnswerDelta(content, index) {
  return {
    id: String(index),
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content },
        finish_reason: null,
      },
    ],
    contentType: '1002',
  };
}

function buildAnswerEnd() {
  return {
    object: 'chat.completion.chunk',
    choices: [
      {
        index: 0,
        delta: { role: 'assistant', content: '' },
        finish_reason: 'stop',
      },
    ],
    contentType: '1002',
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

  for (let index = 0; index < chars.length; index += CHUNK_SIZE) {
    const chunk = chars.slice(index, index + CHUNK_SIZE).join('');
    writeSse(res, 'answerDelta', buildAnswerDelta(chunk, index / CHUNK_SIZE));
    await sleep(DELAY_MS);
  }

  writeSse(res, 'answerEnd', buildAnswerEnd());
  res.write('data: [DONE]\n\n');
  res.end();
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    });
    res.end();
    return;
  }

  if (req.method !== 'POST') {
    res.writeHead(405, {
      'Content-Type': 'application/json; charset=utf-8',
      'Access-Control-Allow-Origin': '*',
      Allow: 'POST, OPTIONS',
    });
    res.end(JSON.stringify({ error: 'Only POST requests are supported.' }));
    return;
  }

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
    writeSse(res, 'error', {
      message: error.message,
      traceback: error.stack || error.message,
      error_code: 500,
    });
    res.write('data: [DONE]\n\n');
    res.end();
  }
});

server.listen(PORT, HOST, () => {
  console.log(`SSE test API listening on http://${HOST}:${PORT}`);
  console.log(`Streaming file: ${FILE_PATH}`);
});
