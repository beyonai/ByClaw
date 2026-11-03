import { act, fireEvent, render, screen } from '@testing-library/react';

import ProjectDataSources from '@/components/ProjectDataSources';
import { useProjectDataSourcesEnabled } from '@/components/ProjectDataSources/useProjectDataSourcesEnabled';
import { downloadResourceFile } from '@/service/file';
import type { FileBrowserItem } from '@/service/fileBrowser';

import ProjectResources from '.';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl, useSelector: () => ({ userId: 1 }) }));
jest.mock('@/components/ProjectDataSources/useProjectDataSourcesEnabled', () => ({
  useProjectDataSourcesEnabled: jest.fn(),
}));
jest.mock('@/components/ProjectDataSources', () => jest.fn(() => <div>project data sources</div>));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn().mockResolvedValue([]) }));
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel', () => () => null);
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel', () => {
  const report = { name: 'report.html', path: '/reports/report.html', size: 3_100_000, isDir: false };
  return function MockFileResourcePanel({
    canPreviewItem,
    onPreviewFile,
  }: {
    canPreviewItem?: (item: FileBrowserItem) => boolean;
    onPreviewFile?: (item: FileBrowserItem) => void;
  }) {
    return (
      <button
        type="button"
        disabled={!canPreviewItem?.(report)}
        onClick={() => onPreviewFile?.(report)}
      >
        Preview cloud report
      </button>
    );
  };
});
jest.mock('@/components/Preview/Twins', () => ({
  PreViewFile: ({ title, onHtmlLinkClick }: { title: string; onHtmlLinkClick: (path: string) => void }) => (
    <button
      type="button"
      onClick={() => onHtmlLinkClick('details.html')}
    >
      Previewing {title}
    </button>
  ),
}));
jest.mock('@/service/file', () => ({ downloadResourceFile: jest.fn() }));
jest.mock('@/layout/sider/components/FileSiderPanel/components/FileSpaceBlock', () => () => null);
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/devloop', () => ({
  listProjectRepos: jest.fn().mockResolvedValue([]),
  listProjectResources: jest.fn().mockResolvedValue([]),
  listScanSources: jest.fn().mockResolvedValue([]),
}));
jest.mock('@/service/knowledgeCenter', () => ({}));
jest.mock('@/pages/manager/service/resources', () => ({ listResourceUseAuth: jest.fn().mockResolvedValue([]) }));
jest.mock('../../hooks/useDigitalEmployeeOptions', () => ({
  useDigitalEmployeeOptions: () => ({ options: [], loading: false }),
}));

beforeEach(() => jest.clearAllMocks());

it.each([false, true])('only mounts the project data card when the edition permits it: %s', async (enabled) => {
  jest.mocked(useProjectDataSourcesEnabled).mockReturnValue(enabled);
  await act(async () => {
    render(
      <ProjectResources
        project={{
          projectId: '11',
          projectName: 'Project',
          projectType: 'normal',
          createBy: 1,
          isShare: 'N',
          sharedFlag: false,
        }}
      />
    );
  });
  expect(screen.queryByText('project data sources') !== null).toBe(enabled);
  expect(jest.mocked(ProjectDataSources).mock.calls.length > 0).toBe(enabled);
});

it.each([390, 1440])('%i 像素视口下在项目详情抽屉预览大 HTML 和相对文件', async (width) => {
  const originalWidth = window.innerWidth;
  const file = new Blob([new Uint8Array(3_100_000)], { type: 'text/html' });
  jest.mocked(useProjectDataSourcesEnabled).mockReturnValue(false);
  jest.mocked(downloadResourceFile).mockResolvedValue({ file });
  Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });

  try {
    await act(async () => {
      render(
        <ProjectResources
          project={{
            projectId: '11',
            cloudResourceId: '42',
            projectName: 'Project',
            projectType: 'normal',
            createBy: 1,
            isShare: 'N',
            sharedFlag: false,
          }}
        />
      );
    });
    fireEvent.click(screen.getByRole('button', { name: 'Preview cloud report' }));
    const report = await screen.findByRole('button', { name: 'Previewing report.html' });
    expect(downloadResourceFile).toHaveBeenLastCalledWith({ resourceId: '42', directoryPath: '/reports/report.html' });

    fireEvent.click(report);
    expect(await screen.findByRole('button', { name: 'Previewing details.html' })).toBeInTheDocument();
    expect(downloadResourceFile).toHaveBeenLastCalledWith({ resourceId: '42', directoryPath: '/reports/details.html' });
  } finally {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: originalWidth });
  }
});
