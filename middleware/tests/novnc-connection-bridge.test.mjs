import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

import { createConnectionBridge as bridgeFactory } from '../builtin/runtime-tools/browser-viewer/connection-bridge.mjs';

function page(relativePath) {
  const html = readFileSync(new URL(relativePath, import.meta.url), 'utf8');
  const script = html.match(/<script type="module">([\s\S]*?)<\/script>/)[1].replace(/^\s*import .*;$/gm, '');
  const elements = new Map();
  const element = (id) => {
    if (!elements.has(id)) elements.set(id, {
      textContent: '', disabled: false, style: {}, checked: false, value: '', innerHTML: '',
      classList: { add() {}, remove() {}, toggle() {} },
      listeners: new Map(),
      addEventListener(type, callback) { this.listeners.set(type, callback); },
      contains() { return false; },
    });
    return elements.get(id);
  };
  const messages = [];
  const listeners = new Map();
  const host = {
    location: new URL('https://viewer.example.test/proxy/8081/?token=test'),
    parent: { postMessage: (payload, origin) => messages.push({ payload, origin }) },
    addEventListener: (type, callback) => listeners.set(type, callback),
    removeEventListener: (type) => listeners.delete(type),
  };
  class FakeRFB {
    static instances = [];
    constructor() { this.events = new Map(); FakeRFB.instances.push(this); }
    addEventListener(type, callback) { this.events.set(type, callback); }
    emit(type, clean) { this.events.get(type)?.({ detail: { clean } }); }
    disconnect() {}
    focus() {}
  }
  const document = { getElementById: element, body: element('body'), addEventListener() {} };
  vm.runInNewContext(script, {
    window: host, document, RFB: FakeRFB, URL, URLSearchParams, setInterval: () => 1, clearInterval() {},
    createConnectionBridge: (...args) => bridgeFactory(...args),
  });
  const handshake = (channelId = 'channel-1', source = host.parent) => listeners.get('message')?.({
    source, origin: 'https://parent.example.test',
    data: { type: 'beyond-iframe-payload', data: { bridge: { version: 1, channelId } } },
  });
  return { element, messages, host, handshake, instances: FakeRFB.instances };
}

for (const source of ['../byclaw-harness/browser/novnc-index.html', '../openclaw/novnc-index.html']) {
  test(`${source}: snapshots a real early connect, resets retries, ignores the discarded RFB`, () => {
    const view = page(source);
    const first = view.instances[0];
    first.emit('connect');
    assert.equal(view.messages.length, 0, 'standalone remains silent');
    view.handshake();
    assert.equal(view.messages.at(-1)?.payload.data.data.state, 'connected');
    assert.equal(view.messages.at(-1).origin, 'https://parent.example.test');
    view.element('btnReconnect').listeners.get('click')();
    assert.equal(view.messages.at(-1).payload.data.type, 'connection-observation-reset');
    view.instances[1].emit('connect');
    first.emit('disconnect', false);
    assert.equal(view.element('statusText').textContent, '已连接');
    assert.equal(view.messages.at(-1).payload.data.data.state, 'connected');
    assert.equal(view.messages.at(-1).payload.data.data.attemptId, 2);
    view.instances[1].emit('disconnect', true);
    assert.equal(view.messages.at(-1).payload.data.data.clean, true);
    view.handshake('channel-2');
    assert.equal(view.messages.at(-1).payload.data.data.channelId, 'channel-2');
    assert.equal(view.messages.at(-1).payload.data.data.state, 'disconnected');
  });

  test(`${source}: does not acknowledge another window or replay old connected during a new attempt`, () => {
    const view = page(source);
    view.instances[0].emit('connect');
    view.handshake('bad-channel', {});
    assert.equal(view.messages.length, 0);
    view.element('btnReconnect').listeners.get('click')();
    view.handshake();
    assert.equal(view.messages.length, 1);
    assert.equal(view.messages[0].payload.data.type, 'connection-observation-reset');
    assert.equal(view.messages[0].payload.data.data.attemptId, 2);
  });
}
