import React from 'react';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { ProjectSpace } from '@/pages/projectSpace/types';
import WorkspaceProjectActions from '../WorkspaceProjectActions';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: () => ({ userId: 1 }),
}));

jest.mock('@/service/devloop', () => ({
  deleteProject: jest.fn(),
  updateProject: jest.fn(),
}));

const project: ProjectSpace = {
  projectId: '1001',
  projectName: '测试项目',
  projectType: 'normal',
  isShare: 'N',
  sharedFlag: false,
  createBy: 1,
};

describe('WorkspaceProjectActions', () => {
  it('shows rename and delete in the more menu and exposes the new-session action', async () => {
    const onNewSession = jest.fn();
    render(<WorkspaceProjectActions project={project} onNewSession={onNewSession} onProjectChanged={jest.fn()} />);

    fireEvent.click(screen.getByRole('button', { name: 'common.more' }));
    await waitFor(() => {
      expect(screen.getByText('common.rename')).toBeInTheDocument();
      expect(screen.getByText('projectSpace.message.deleteConfirmTitle')).toBeInTheDocument();
    });

    fireEvent.click(screen.getByRole('button', { name: 'workspaceSider.newSession' }));
    expect(onNewSession).toHaveBeenCalledWith(project);
  });

  it('hides project management actions when the user is not the project creator', () => {
    render(
      <WorkspaceProjectActions
        project={{ ...project, createBy: 2 }}
        onNewSession={jest.fn()}
        onProjectChanged={jest.fn()}
      />
    );

    expect(screen.queryByRole('button', { name: 'common.more' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'workspaceSider.newSession' })).toBeInTheDocument();
  });
});
