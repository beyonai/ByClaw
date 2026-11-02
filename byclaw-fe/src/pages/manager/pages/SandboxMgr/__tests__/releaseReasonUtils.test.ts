import { getLocaleIntl } from '@/testUtils/localeIntl';
import { formatReleaseReason } from '../releaseReasonUtils';

const chinese = getLocaleIntl('zh-CN');
const english = getLocaleIntl('en-US');

test.each([
  ['release.switch-to-shared', '已切换至共享沙箱', 'Switched to shared sandbox'],
  ['release.auto.idle-timeout', '空闲超时自动释放', 'Automatically released after idle timeout'],
  ['release.manual:operator note', '手动释放：operator note', 'Manual release: operator note'],
  [
    'orphan:RUNNING:release.remote.exit',
    '孤立沙箱：运行中；远端沙箱已退出',
    'Orphaned sandbox: Running; Remote sandbox exited',
  ],
  ['release.retry', '重试释放', 'Release retried'],
])('localizes structured reason %s while keeping operator details', (reason, zh, en) => {
  expect(formatReleaseReason(chinese, reason)).toBe(zh);
  expect(formatReleaseReason(english, reason)).toBe(en);
});

test('preserves unknown diagnostics and renders absent reasons as empty cells', () => {
  expect(formatReleaseReason(chinese, 'provider: connection reset')).toBe('provider: connection reset');
  expect(formatReleaseReason(chinese, null)).toBe('-');
  expect(formatReleaseReason(english, '  ')).toBe('-');
});
