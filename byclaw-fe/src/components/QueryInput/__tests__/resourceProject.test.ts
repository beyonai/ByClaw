import { getInputResourceProject } from '../utils/resourceProject';

describe('input resource project', () => {
  const sessionProject = { projectId: 12, projectCloudResourceId: 'old-cloud' };

  it.each(['42', '-1'])('follows the project selector before sending: %s', (projectId) => {
    expect(
      getInputResourceProject({
        ...sessionProject,
        selectedProject: { projectId, cloudResourceId: 'selected-cloud' },
      })
    ).toEqual({ projectId: Number(projectId), projectCloudResourceId: 'selected-cloud' });
  });

  it('does not reuse the old cloud drive while the selected project details load', () => {
    expect(
      getInputResourceProject({
        ...sessionProject,
        sessionId: 'retained-session',
        isBottom: false,
        selectedProject: { projectId: '42' },
      })
    ).toEqual({ projectId: 42, projectCloudResourceId: undefined });
  });

  it('keeps existing conversations scoped to their own project', () => {
    expect(
      getInputResourceProject({
        ...sessionProject,
        sessionId: 'existing-session',
        isBottom: true,
        selectedProject: { projectId: '42', cloudResourceId: 'selected-cloud' },
      })
    ).toEqual(sessionProject);
  });

  it('preserves the supplied project when no selection has been made', () => {
    expect(getInputResourceProject(sessionProject)).toEqual(sessionProject);
  });
});
