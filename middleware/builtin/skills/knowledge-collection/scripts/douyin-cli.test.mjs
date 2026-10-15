import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const CLI = fileURLToPath(new URL('./knowledge-collection.mjs', import.meta.url));
const SOURCE = 'https://v.douyin.com/RpopXC5PB9c/';
function invoke(argv, env = process.env) {
  const result = spawnSync(process.execPath, [CLI, ...argv], { env, encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 });
  assert.ifError(result.error);
  return { code: result.status, value: JSON.parse(result.stdout) };
}
test('actual CLI exposes archive constraints and bounded descriptions through registered help/schema', () => {
  const schema = invoke(['command-schema']).value;
  for (const name of ['acquire-douyin', 'materialize-douyin']) {
    const help = invoke([name, '--help']);
    assert.equal(help.code, 0);
    assert.ok(help.value.title.length <= 250);
    for (const description of Object.values(help.value.args)) assert.ok(description.length <= 150);
    assert.equal(schema.commands[name].additionalProperties, false);
    assert.deepEqual(schema.commands[name].required,
      name === 'acquire-douyin' ? ['session-dir', 'item-id', 'source-url'] : ['session-dir', 'item-id', 'executor-result-file']);
  }
  assert.equal(schema.commands['acquire-douyin'].properties['verification-confirmed'].type, 'boolean');
  assert.equal(schema.commands['acquire-douyin'].properties['verification-confirmed'].default, false);
});
function fixture(t, auth = false, officialSubtitles = false, source = SOURCE) {
  const root = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'douyin-cli-')));
  t.after(() => fs.rmSync(root, { recursive: true, force: true }));
  const bin = path.join(root, 'bin'); fs.mkdirSync(bin);
  const log = path.join(root, 'calls.jsonl'), blocked = path.join(root, 'auth');
  if (auth) fs.writeFileSync(blocked, 'auth');
  const bridge = path.join(root, 'bridge.mjs');
  fs.writeFileSync(bridge, `console.log(JSON.stringify({ok:true,code:'BRIDGE_READY'}));`);
  fs.writeFileSync(path.join(bin, 'bycli'), `#!/usr/bin/env node
const fs=require('node:fs'),path=require('node:path'),a=process.argv.slice(2),id='1234567890123456789';
fs.appendFileSync(process.env.DOUYIN_FIXTURE_LOG,JSON.stringify(a)+'\\n');
const ok=value=>console.log(JSON.stringify(value));
if(a[0]==='list')ok(['download','read'].map(name=>({site:'douyin',name})));
else if(a.includes('--help'))ok({site:'douyin',name:a[1],access:'read',browser:true,domain:'www.douyin.com',positionals:[{name:'target'}],command_options:(a[1]==='download'?['output','metadata']:['comments','replies']).map(name=>({name})),common_options:[{name:'format',choices:['json']}],browser_common_options:[{name:'keep-tab',choices:['true','false']},{name:'site-session',choices:['ephemeral','persistent']},{name:'window',choices:['foreground','background']}]});
else if(a[1]==='download'){
 const dir=a[a.indexOf('--output')+1];fs.mkdirSync(dir,{recursive:true});
 const v=path.join(dir,id+'.mp4'),m=path.join(dir,id+'.json');
 fs.writeFileSync(v,Buffer.from('000000186674797069736f6d0000020000000000','hex'));
 fs.writeFileSync(m,JSON.stringify({aweme_id:id,url:'https://www.douyin.com/video/'+id,title:'测试视频',media_type:'video',author:{nickname:'作者'}}));
 ok([{aweme_id:id,type:'video',status:'success',path:v,bytes:fs.statSync(v).size},{aweme_id:id,type:'metadata',status:'success',path:m,bytes:fs.statSync(m).size}]);
}else if(fs.existsSync(process.env.DOUYIN_FIXTURE_AUTH)){console.error(JSON.stringify({error:{code:'AUTH_REQUIRED'}}));process.exitCode=77;}
else ok([{work:{aweme_id:id,media_type:'video'},comments:null,subtitles:process.env.DOUYIN_FIXTURE_SUBTITLES==='true'?[{source:'official_subtitle',status:'available',language:'zh',format:'vtt',cues:[{from:0,to:2,text:'归档字幕'}]}]:[],limitations:[]}]);
`, { mode: 0o700 });
  const sessionsRoot = path.join(root, 'by/.sessions'), sessionRoot = path.join(sessionsRoot, 'test');
  const env = { ...process.env, PATH: `${bin}${path.delimiter}${process.env.PATH}`, BYCLI_BRIDGE_BOOTSTRAP_SCRIPT: bridge,
    ...(officialSubtitles ? { KNOWLEDGE_COLLECTION_SESSIONS_ROOT: sessionsRoot } : {}),
    DOUYIN_FIXTURE_LOG: log, DOUYIN_FIXTURE_AUTH: blocked, DOUYIN_FIXTURE_SUBTITLES: String(officialSubtitles) };
  const dir = officialSubtitles ? path.join(sessionRoot, '.collection-runs/run') : path.join(root, 'session');
  const delivery = path.join(root, 'delivery');
  const initialized = invoke(['init', '--session-dir', dir, '--query', '抖音视频归档', '--source-scope', '["public-internet"]',
    '--direct-urls', JSON.stringify([source]), '--required-content-granularity', 'any',
    ...(officialSubtitles ? ['--session-root', sessionRoot, '--delivery-requested', 'true', '--delivery-dir', delivery] : [])], env);
  assert.equal(initialized.code, 0, initialized.value.error);
  return { dir, env, log, blocked, delivery, handle: initialized.value.task?.deliveryTarget?.handle,
    argv: ['acquire-douyin', '--session-dir', dir, '--item-id', 'video', '--source-url', source] };
}
test('actual CLI archives without subtitles then collect/status reports archive complete and zero full-text', t => {
  const f = fixture(t);
  const acquired = invoke(f.argv, f.env);
  assert.equal(acquired.code, 0, JSON.stringify(acquired.value));
  assert.equal(acquired.value.subtitleStatus, 'not-provided');
  const materialized = invoke(['materialize-douyin', '--session-dir', f.dir, '--item-id', 'video',
    '--executor-result-file', acquired.value.executorResultFile], f.env);
  assert.equal(materialized.code, 0, JSON.stringify(materialized.value));
  const collected = invoke(['collect', '--session-dir', f.dir, '--item-json-file', materialized.value.collectPayloadPath], f.env);
  assert.equal(collected.code, 0, collected.value.error);
  const status = invoke(['status', '--session-dir', f.dir], f.env);
  assert.equal(status.value.collection.deliveryComplete, true);
  assert.equal(status.value.collection.contentGranularity['full-text'], 0);
  assert.equal(status.value.collection.contentGranularity.unknown, 1);
  const rejected = invoke([...f.argv, '--unknown-option', 'true'], f.env);
  assert.equal(rejected.code, 1);
});
test('actual CLI retains an authorized modal URL through video acquisition, materialization and collection', t => {
  const source = 'https://www.douyin.com/jingxuan?recommend=1&modal_id=1234567890123456789';
  const f = fixture(t, false, false, source);
  const acquired = invoke(f.argv, f.env);
  assert.equal(acquired.code, 0, JSON.stringify(acquired.value));
  const receipt = JSON.parse(fs.readFileSync(acquired.value.executorResultFile, 'utf8'));
  assert.equal(receipt.sourceUrl, source);
  assert.equal(receipt.workId, '1234567890123456789');
  assert.equal(receipt.canonicalUrl, 'https://www.douyin.com/video/1234567890123456789');
  const sourceCommands = fs.readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse)
    .filter(argv => argv[0] === 'douyin' && !argv.includes('--help'));
  assert.deepEqual(sourceCommands.map(argv => [argv[1], argv[2]]), [
    ['download', source], ['read', 'https://www.douyin.com/video/1234567890123456789'],
  ]);
  const materialized = invoke(['materialize-douyin', '--session-dir', f.dir, '--item-id', 'video',
    '--executor-result-file', acquired.value.executorResultFile], f.env);
  assert.equal(materialized.code, 0, JSON.stringify(materialized.value));
  const payload = JSON.parse(fs.readFileSync(materialized.value.collectPayloadPath, 'utf8'));
  assert.equal(payload.sourceUrl, source);
  assert.equal(payload.canonicalItem.url, source);
  assert.equal(payload.sourceMetadata.workId, '1234567890123456789');
  assert.ok(fs.readFileSync(path.join(f.dir, payload.sanitizedPath), 'utf8').includes(source));
  assert.equal(invoke(['collect', '--session-dir', f.dir, '--item-json-file', materialized.value.collectPayloadPath], f.env).code, 0);
  const status = invoke(['status', '--session-dir', f.dir], f.env);
  assert.equal(status.value.collection.deliveryComplete, true);
  assert.equal(status.value.collection.contentGranularity['full-text'], 0);
  assert.equal(status.value.collection.contentGranularity.unknown, 1);
});
test('actual CLI exits nonzero on auth and does not repeat download on confirmed resume', t => {
  const f = fixture(t, true);
  const paused = invoke(f.argv, f.env);
  assert.equal(paused.code, 1);
  assert.equal(paused.value.requiresUserAction, true);
  const callsBefore = fs.readFileSync(f.log, 'utf8');
  assert.equal(invoke(f.argv, f.env).code, 1);
  assert.equal(fs.readFileSync(f.log, 'utf8'), callsBefore);
  fs.unlinkSync(f.blocked);
  const resumed = invoke([...f.argv, '--verification-confirmed', 'true'], f.env);
  assert.equal(resumed.code, 0, JSON.stringify(resumed.value));
  const calls = fs.readFileSync(f.log, 'utf8').trim().split('\n').map(JSON.parse);
  assert.equal(calls.filter(argv => argv[1] === 'download' && !argv.includes('--help')).length, 1);
});

test('actual CLI carries official subtitles and video through acquisition, materialization, collect and publish', t => {
  const f = fixture(t, false, true);
  const acquired = invoke(f.argv, f.env);
  assert.equal(acquired.code, 0, JSON.stringify(acquired.value));
  assert.equal(acquired.value.subtitleStatus, 'available');
  const materialized = invoke(['materialize-douyin', '--session-dir', f.dir, '--item-id', 'video',
    '--executor-result-file', acquired.value.executorResultFile], f.env);
  assert.equal(materialized.code, 0, JSON.stringify(materialized.value));
  assert.equal(invoke(['collect', '--session-dir', f.dir, '--item-json-file', materialized.value.collectPayloadPath], f.env).code, 0);
  const published = invoke(['publish', '--session-dir', f.dir, '--delivery-handle', f.handle], f.env);
  assert.equal(published.code, 0, JSON.stringify(published.value));
  const markdown = fs.readFileSync(path.join(f.delivery, 'video.md'), 'utf8');
  assert.match(markdown, /video-assets\/1234567890123456789\.mp4/);
  assert.match(markdown, /video-assets\/subtitle-01\.vtt/);
  assert.match(fs.readFileSync(path.join(f.delivery, 'video-assets/subtitle-01.vtt'), 'utf8'), /归档字幕/);
  assert.deepEqual(fs.readdirSync(path.join(f.delivery, 'video-assets')).sort(),
    ['1234567890123456789.mp4', 'metadata.json', 'subtitle-01.json', 'subtitle-01.vtt']);
});
