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
  // 交付目标改为 init 阶段绑定后，允许出现裸路径的调用是首次 init 与最终 publish 两处；
  // 探测禁令本身未放松，仍由下面四条断言逐字锁住。
  assert.match(document, /除首次 `init` 的 `--delivery-dir` 与最终的 `publish` 之外/);
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
  /WSA.*搜索摘要.*发现证据.*不是.*正文/s,
);
assert.match(
  skill,
  /明确要求.*数量.*必须使用 `public-collect`/s,
);
assert.match(
  skill,
  /`public-discover`.*`acquire-web`.*`materialize-web`.*`collect`.*不能.*复现.*闭环/s,
);
assert.match(skill, /STOP before all collection tools: require Session Root/);
assert.match(
  skill,
  /没有完整绝对 Session Root.*下一步必须直接向上游请求该值并结束本轮.*不得为了寻找 Session Root 再调用 `exec`、`read`、`session_status`/s,
);
assert.match(skill, /不得用 `ls`、`find`、glob 枚举 `\/by\/\.sessions\/`/);
// 旧禁令「init 命令不得包含 --delivery-dir」已被绑定流程取代：交付目标在 init 阶段一次性绑定，
// 之后只以 handle 引用。取代它的是「init 不做任何文件系统访问」这条更强的约束。
assert.match(skill, /`init` 不对交付目录做任何文件系统访问/);
assert.doesNotMatch(skill, /`init` 命令不得包含 `--delivery-dir`/);
assert.match(
  skill,
  /只有.*晋升.*已验证正文.*才能计入.*requestedItemCount/s,
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
