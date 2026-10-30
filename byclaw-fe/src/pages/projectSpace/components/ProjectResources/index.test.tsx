import { act, render, screen } from '@testing-library/react';
import ProjectDataSources from '@/components/ProjectDataSources';
import { useProjectDataSourcesEnabled } from '@/components/ProjectDataSources/useProjectDataSourcesEnabled';
import ProjectResources from '.';

const mockIntl = { formatMessage: ({ id }: { id: string }) => id };
jest.mock('@umijs/max', () => ({ useIntl: () => mockIntl, useSelector: () => ({ userId: 1 }) }));
jest.mock('@/components/ProjectDataSources/useProjectDataSourcesEnabled', () => ({
  useProjectDataSourcesEnabled: jest.fn(),
}));
jest.mock('@/components/ProjectDataSources', () => jest.fn(() => <div>project data sources</div>));
jest.mock('@/components/ProjectCloudDrive', () => ({ queryProjectCloudDrive: jest.fn().mockResolvedValue({}) }));
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FilePreviewPanel', () => () => null);
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel', () => () => null);
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
