import { getE2eContractExamples } from './contracts';

it('localizes example explanations without changing protocol values or executable shell lines', () => {
  const zh = getE2eContractExamples('zh-CN');
  const en = getE2eContractExamples('en-US');
  expect(en.statuses.map(({ code }) => code)).toEqual(zh.statuses.map(({ code }) => code));
  expect(en.resultDirTree).toContain('$BYCLAW_E2E_RESULT_DIR/');
  expect(en.resultDirTree).not.toMatch(/[\u4e00-\u9fff]/);
  expect(en.statusJson).toContain('"schemaVersion": 1');
  expect(en.scriptSkeleton).toContain('write_status() { echo "$1" > "$DIR/status.json.tmp"');
  expect(en.suiteContract).toContain('[[ATTACHMENT|artifacts/<suiteId>/<caseId>.png]]');
  expect(getE2eContractExamples('zh-CN').statusJson).toBe(zh.statusJson);
});
