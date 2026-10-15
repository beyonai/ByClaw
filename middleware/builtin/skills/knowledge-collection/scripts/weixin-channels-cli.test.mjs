import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';

const CLI = fileURLToPath(new URL('./knowledge-collection.mjs', import.meta.url));
const SOURCE = 'https://channels.weixin.qq.com/platform/statistic/post';
const POST_ID = '18446744073709551615';
const digest = bytes => crypto.createHash('sha256').update(bytes).digest('hex');

function invoke(argv, env = process.env) {
  const result = spawnSync(process.execPath, [CLI, ...argv], {
    env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024,
  });
  assert.ifError(result.error);
  return { code: result.status, value: JSON.parse(result.stdout) };
}

test('actual CLI help and registration expose the explicit verification confirmation boolean', () => {
  const help = invoke(['acquire-weixin-channels', '--help']);
  assert.equal(help.code, 0);
  assert.ok(help.value.args['--verification-confirmed']);
  assert.ok(help.value.title.length <= 250);
  for (const description of Object.values(help.value.args)) assert.ok(description.length <= 150);
  const schema = invoke(['command-schema']).value;
  const command = schema.commands['acquire-weixin-channels'];
  assert.equal(command.properties['verification-confirmed'].type, 'boolean');
  assert.equal(command.properties['verification-confirmed'].default, false);
  assert.equal(command.additionalProperties, false);
  assert.deepEqual(command.required, ['session-dir', 'item-id', 'source-url']);
});

function fixture(t, pausedCommand = 'trend') {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'channels-cli-gate-'));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin');
  fs.mkdirSync(bin);
  const log = path.join(root, 'calls.jsonl');
  const auth = path.join(root, 'authentication-required');
  fs.writeFileSync(auth, pausedCommand);
  const bridge = path.join(root, 'bridge.mjs');
  fs.writeFileSync(bridge, `import fs from 'node:fs';
fs.appendFileSync(process.env.CHANNELS_FIXTURE_LOG, JSON.stringify({kind:'bridge'})+'\\n');
console.log(JSON.stringify({ok:true,code:'BRIDGE_READY'}));\n`);
  fs.writeFileSync(path.join(bin, 'bycli'), `#!/usr/bin/env node
import fs from 'node:fs';
const argv=process.argv.slice(2), names=['overview','trend','sources','posts','post-detail'];
fs.appendFileSync(process.env.CHANNELS_FIXTURE_LOG, JSON.stringify({kind:'cli',argv})+'\\n');
const browser=[{name:'keep-tab',choices:['true','false']},{name:'site-session',choices:['persistent','ephemeral']},{name:'window',choices:['background','foreground']}];
if(argv[0]==='list') console.log(JSON.stringify(names.map(name=>({site:'weixin-channels',name}))));
else if(argv.includes('--help')) console.log(JSON.stringify({site:'weixin-channels',common_options:[{name:'format',choices:['json']}],browser_common_options:browser,commands:names.map(name=>({name,access:'read',browser:true,domain:'channels.weixin.qq.com',command_options:[{name:'days'},{name:'start-date'},{name:'end-date'},...(name==='posts'?[{name:'limit'}]:[])],positionals:name==='post-detail'?[{name:'id',required:true}]:[],columns:name==='sources'?['views_pct']:name==='post-detail'?['data_details']:['views']}))}));
else {
 const command=argv[1];
 if(fs.existsSync(process.env.CHANNELS_FIXTURE_AUTH)&&fs.readFileSync(process.env.CHANNELS_FIXTURE_AUTH,'utf8')===command){
  console.error(JSON.stringify({error:{code:'AUTH_REQUIRED',message:'请在保留的测试页面完成验证'}})); process.exitCode=77;
 }else{
  const data={overview:[{start_date:'2026-10-06',end_date:'2026-10-12',views:7}],trend:[{date:'2026-10-06',views:7}],sources:[{source:'推荐',views:7,views_pct:100}],posts:[{id:${JSON.stringify(POST_ID)},title:'测试作品',views:7}],'post-detail':[{id:argv[2],data_details:[{date:'2026-10-06',source:'推荐',views:7}]}]};
  console.log(JSON.stringify(data[command]));
 }
}\n`, { mode: 0o700 });
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`,
    BYCLI_BRIDGE_BOOTSTRAP_SCRIPT: bridge, CHANNELS_FIXTURE_LOG: log, CHANNELS_FIXTURE_AUTH: auth };
  const sessionDir = path.join(root, 'session');
  const initialized = invoke(['init', '--session-dir', sessionDir, '--query', '本地视频号登录续采测试',
    '--source-scope', '["public-internet"]', '--direct-urls', JSON.stringify([SOURCE]),
    '--required-content-granularity', 'any'], env);
  assert.equal(initialized.code, 0, initialized.value.error);
  const argv = ['acquire-weixin-channels', '--session-dir', sessionDir, '--item-id', 'statistics',
    '--source-url', SOURCE, '--days', '7', '--limit', '1'];
  const calls = () => fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(JSON.parse) : [];
  return { root, sessionDir, env, argv, calls, auth };
}

test('actual CLI pauses, resumes only after confirmation, then materializes and completes collection', t => {
  const f = fixture(t);
  const first = invoke(f.argv, f.env);
  assert.equal(first.code, 1);
  assert.equal(first.value.errorCode, 'AUTH_REQUIRED');
  assert.equal(first.value.phase, 'waiting-confirmation');
  assert.equal(first.value.requiresUserAction, true);
  assert.equal(first.value.commandCount, 1);
  const overview = path.join(f.sessionDir, 'raw/bycli/weixin-channels/statistics/overview.json');
  const overviewBefore = digest(fs.readFileSync(overview));
  const firstCalls = f.calls();
  const blocked = invoke(f.argv, f.env);
  assert.equal(blocked.value.phase, 'waiting-confirmation');
  assert.deepEqual(f.calls(), firstCalls, 'unconfirmed resume must not run discovery, bridge, or source');

  fs.unlinkSync(f.auth); // Controlled fixture confirmation; does not modify a real account.
  const resumed = invoke([...f.argv, '--verification-confirmed', 'true'], f.env);
  assert.equal(resumed.code, 0, resumed.value.error);
  assert.equal(resumed.value.commandCount, 5);
  assert.equal(resumed.value.detailCount, 1);
  assert.equal(digest(fs.readFileSync(overview)), overviewBefore);
  assert.equal(f.calls().filter(call => call.kind === 'bridge').length, 1);
  const sources = f.calls().filter(call => call.kind === 'cli' && call.argv[0] === 'weixin-channels' && !call.argv.includes('--help'));
  assert.deepEqual(sources.map(call => call.argv[1]), ['overview', 'trend', 'trend', 'sources', 'posts', 'post-detail']);
  for (const call of sources.slice(1)) {
    assert.equal(call.argv.includes('--days'), false);
    assert.equal(call.argv[call.argv.indexOf('--start-date') + 1], '2026-10-06');
    assert.equal(call.argv[call.argv.indexOf('--end-date') + 1], '2026-10-12');
  }
  const materialized = invoke(['materialize-weixin-channels', '--session-dir', f.sessionDir,
    '--item-id', 'statistics', '--executor-result-file', resumed.value.executorResultFile], f.env);
  assert.equal(materialized.code, 0, materialized.value.error);
  const collected = invoke(['collect', '--session-dir', f.sessionDir,
    '--item-json-file', materialized.value.collectPayloadPath], f.env);
  assert.equal(collected.code, 0, collected.value.error);
  const status = invoke(['status', '--session-dir', f.sessionDir], f.env);
  assert.equal(status.value.collection.deliveryComplete, true);
  assert.equal(status.value.collection.contentGranularity.unknown, 1);
  assert.equal(status.value.collection.contentGranularity['full-text'], 0);
  assert.equal(status.value.downstreamInput.files.length, 1);
});

test('CLI refuses invalid or premature confirmation before any external process', t => {
  const f = fixture(t);
  for (const confirmation of ['yes', '1', 'true']) {
    const result = invoke([...f.argv, '--verification-confirmed', confirmation], f.env);
    assert.equal(result.code, 1);
    assert.equal(result.value.ok, false);
    if (confirmation === 'true') assert.equal(result.value.errorCode, 'ACQUISITION_CONFIRMATION_NOT_PENDING');
    assert.deepEqual(f.calls(), []);
  }
});

test('a confirmation cannot automatically authorize a later operation that also requires login', t => {
  const f = fixture(t);
  assert.equal(invoke(f.argv, f.env).value.phase, 'waiting-confirmation');
  fs.writeFileSync(f.auth, 'sources');
  const laterPause = invoke([...f.argv, '--verification-confirmed', 'true'], f.env);
  assert.equal(laterPause.value.phase, 'waiting-confirmation');
  assert.equal(laterPause.value.failedCommand, 'sources');
  assert.equal(laterPause.value.commandCount, 2);
  const calls = f.calls();
  assert.equal(invoke(f.argv, f.env).value.requiresUserAction, true);
  assert.deepEqual(f.calls(), calls);
  fs.unlinkSync(f.auth);
  assert.equal(invoke([...f.argv, '--verification-confirmed', 'true'], f.env).code, 0);
  assert.equal(f.calls().filter(call => call.kind === 'bridge').length, 1);
});
