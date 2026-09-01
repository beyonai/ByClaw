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
