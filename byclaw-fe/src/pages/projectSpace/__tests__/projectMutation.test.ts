import { getProjectMutationErrorMessage, hasDuplicateProjectName } from '../projectMutation';

describe('project mutation validation', () => {
  const projects = [
    { projectId: '1', projectName: 'Shared project', createBy: '99' },
    { projectId: '2', projectName: 'My project', createBy: '88' },
  ];

  it('allows the name of a project created by another user', () => {
    expect(hasDuplicateProjectName(projects, 'Shared project', 88)).toBe(false);
  });

  it('rejects an existing name belonging to the creator after trimming', () => {
    expect(hasDuplicateProjectName(projects, ' My project ', 88)).toBe(true);
  });

  it('excludes the edited project but still checks other projects of its creator', () => {
    expect(hasDuplicateProjectName(projects, 'My project', 88, 2)).toBe(false);
    expect(hasDuplicateProjectName(projects, 'My project', 88, 3)).toBe(true);
  });

  it('defers validation to the backend when creator information is unavailable', () => {
    expect(hasDuplicateProjectName(projects, 'My project')).toBe(false);
  });
});

describe('project mutation errors', () => {
  it.each([
    'Project name already exists',
    { msg: 'Project name already exists' },
    { data: { msg: 'Project name already exists' } },
    { response: { data: { msg: 'Project name already exists' } }, message: 'HTTP error' },
    new Error('Project name already exists'),
  ])('preserves the API error message for %p', (error) => {
    expect(getProjectMutationErrorMessage(error, 'Creation failed')).toBe('Project name already exists');
  });

  it.each([undefined, null, '', ' ', {}, { msg: ' ', message: '' }])(
    'uses the localized fallback when no message is available: %p',
    (error) => {
      expect(getProjectMutationErrorMessage(error, 'Creation failed')).toBe('Creation failed');
    }
  );
});
