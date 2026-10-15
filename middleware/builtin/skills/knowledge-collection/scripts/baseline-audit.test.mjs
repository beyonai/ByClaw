import assert from 'node:assert/strict';
import test from 'node:test';

import { auditBaselineContent, normalizeAuditParagraph } from './baseline-audit.mjs';

const paragraphs = (count, prefix = '段落') => Array.from(
  { length: count },
  (_, index) => `${prefix}${index + 1}：这是用于性能审计的一段完整正文内容。`,
);
const markdown = (rows) => `${rows.join('\n\n')}\n`;

test('normalizes Unicode width, whitespace, and punctuation deterministically', () => {
  assert.equal(
    normalizeAuditParagraph('ＡＢＣ，  米哈游！\n新进展。'),
    normalizeAuditParagraph('ABC, 米哈游! 新进展.'),
  );
});

test('accepts the exact 90 percent coverage boundary', () => {
  const raw = paragraphs(10);
  const result = auditBaselineContent({ rawMarkdown: markdown(raw), finalMarkdown: markdown(raw.slice(0, 9)) });
  assert.equal(result.status, 'passed');
  assert.equal(result.coverageRatio, 0.9);
  assert.equal(result.fidelityRatio, 1);
});

test('rejects coverage below 90 percent as audit-unknown', () => {
  const raw = paragraphs(100);
  const result = auditBaselineContent({ rawMarkdown: markdown(raw), finalMarkdown: markdown(raw.slice(0, 89)) });
  assert.equal(result.status, 'audit-unknown');
  assert.equal(result.coverageRatio, 0.89);
});

test('accepts 95 percent fidelity and rejects 94 percent', () => {
  const raw95 = paragraphs(19);
  const pass = auditBaselineContent({
    rawMarkdown: markdown(raw95),
    finalMarkdown: markdown([...raw95, '额外段落：这一段不在原始正文中。']),
  });
  assert.equal(pass.status, 'passed');
  assert.equal(pass.fidelityRatio, 0.95);

  const raw94 = paragraphs(94);
  const fail = auditBaselineContent({
    rawMarkdown: markdown(raw94),
    finalMarkdown: markdown([...raw94, ...paragraphs(6, '额外')]),
  });
  assert.equal(fail.status, 'audit-unknown');
  assert.equal(fail.fidelityRatio, 0.94);
});

test('ordered one-to-one matching prevents duplicate and reordered inflation', () => {
  const raw = paragraphs(4);
  const result = auditBaselineContent({
    rawMarkdown: markdown(raw),
    finalMarkdown: markdown([raw[0], raw[0], raw[2], raw[1], raw[3], '额外杜撰段落']),
  });
  assert.equal(result.matchedCount, 3);
  assert.equal(result.status, 'audit-unknown');
  assert.ok(result.extraParagraphs.length > 0);
});

test('challenge, truncation, and insufficient content are audit-unknown', () => {
  for (const rawMarkdown of ['请完成验证码后继续访问', '正文输出已截断 truncated']) {
    const result = auditBaselineContent({ rawMarkdown, finalMarkdown: rawMarkdown });
    assert.equal(result.status, 'audit-unknown');
    assert.match(result.reason, /challenge|truncation/);
  }
  assert.equal(auditBaselineContent({ rawMarkdown: '一段', finalMarkdown: '一段' }).status, 'audit-unknown');
});
