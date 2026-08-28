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
  assert.doesNotMatch(document, /不得调用 `by-knowledge-manager`/);
  assert.doesNotMatch(document, /不得调用 `knowledge-organizer`/);
  assert.match(document, /不得主动询问 `入库 \/ 知识整理 \/ 跳过`/);
  assert.match(document, /根 Agent.*用户.*意图.*决定.*下游 Skill/);
}
