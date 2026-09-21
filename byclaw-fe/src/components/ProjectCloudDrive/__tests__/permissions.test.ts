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
