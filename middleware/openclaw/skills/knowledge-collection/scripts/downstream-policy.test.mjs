import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const skillDir = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const documents = [
  readFileSync(resolve(skillDir, 'SKILL.md'), 'utf8'),
  readFileSync(resolve(skillDir, 'references/delivery.md'), 'utf8'),
];

for (const document of documents) {
  assert.doesNotMatch(document, /不得调用 `project-cloud-knowledge`/);
  assert.doesNotMatch(document, /不得调用 `knowledge-organizer`/);
  assert.match(document, /不得主动询问 `入库 \/ 知识整理 \/ 跳过`/);
  assert.match(document, /根 Agent.*用户.*意图.*决定.*下游 Skill/);

  assert.match(
    document,
    /任何工具调用的参数或 shell 命令文本都不得包含 `requestedDeliveryDir`/,
  );
  assert.match(document, /第一次允许包含该路径的工具调用必须是正式的 `publish`/);
  assert.match(document, /不得把该路径赋给 shell 变量，也不得 `echo`、记录或打印该路径/);
  assert.match(document, /`mkdir`、`ls`、`find`、`stat`、`test`、`realpath`、`readlink`/);
  assert.match(document, /“检查残留目录”、“确认目录不存在”和“只做只读检查”都不是例外/);
  assert.match(
    document,
    /`status\.collection\.deliveryComplete=false`.*该路径不得出现在后续任何工具调用中/,
  );
}

const skill = documents[0];

assert.match(
  skill,
  /`eligibleArticle=0`.*`status\.task\.discoveryGate\.attemptCount < maxAttempts`.*必须执行第二轮 `public-discover`/s,
);
assert.match(skill, /不得因主题看似不存在、首轮结果明显无关或预计第二轮仍会失败而跳过第二轮/);
assert.match(
  skill,
  /只有 `exhausted=true`、`stopReason=no-article-candidates` 和 `stopDetail=no-relevant-article-candidates` 同时成立，才能把公共发现报告为已耗尽并停止/s,
);
assert.match(
  skill,
  /最终答复前.*重新运行 `status`.*原样核对并报告 `attemptCount`、`maxAttempts`、`exhausted`、`stopReason` 和 `stopDetail`/s,
);
assert.match(skill, /STOP before all collection tools: require Session Root/);
assert.match(
  skill,
  /没有完整绝对 Session Root.*下一步必须直接向上游请求该值并结束本轮.*不得为了寻找 Session Root 再调用 `exec`、`read`、`session_status`/s,
);
assert.match(skill, /不得用 `ls`、`find`、glob 枚举 `\/by\/\.sessions\/`/);
assert.match(skill, /`init` 命令不得包含 `--delivery-dir`/);
assert.match(
  skill,
  /`eligibleArticle>0`.*按 `articleCandidateIds` 的确定性顺序选择候选并继续授权的抓取、物化与 `collect`/s,
);
assert.match(skill, /STOP before browser-backed byCLI commands: one recovery owner/);
assert.match(
  skill,
  /must never run `bycli doctor`, `bycli daemon status`, `bycli daemon restart`, `\/usr\/local\/bin\/start-chrome\.sh`, `openclaw browser`/,
);
assert.match(
  skill,
  /invoke exactly `node \/app\/skills\/bycli\/scripts\/bridge-bootstrap\.mjs --format json` once/,
);
assert.match(
  skill,
  /`BRIDGE_UNAVAILABLE` or `BRIDGE_RECOVERY_BUSY`.*run collection `status`.*stop.*do not inspect, repair, or retry the bridge/s,
);
assert.match(skill, /Only its structured `actions` may be used to claim that one of those actions ran/);
