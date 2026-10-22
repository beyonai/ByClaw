jest.mock('@umijs/max', () => ({ getIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl('en-US') }));

import { normalizeProjectCloudDriveItem } from '..';

it.each([true, false, undefined])(
  'preserves the server item permission %s without inferring it from names',
  (allowed) => {
    const item = normalizeProjectCloudDriveItem({
      name: '/reports/file.md',
      type: 'file',
      directoryPath: '/reports/file.md',
      createStaffName: 'same display name',
      canManageItem: allowed,
    });
    expect(item.canManageItem).toBe(allowed === true);
  }
);

it('localizes an unnamed file label without changing the legacy fallback path', () => {
  const item = normalizeProjectCloudDriveItem({ type: 'file' });
  expect(item.name).toBe('File');
  expect(item.path).toBe('/文件');
});
