import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import Compare from '../index';
import { getEmployeeVersion, getEmployeeVersions } from '@/service/employeeVersions';

jest.mock('@umijs/max', () => ({
  useLocation: () => ({ search: '?resourceId=10&left=1&right=2' }),
  history: { back: jest.fn() },
}));
jest.mock('@/service/employeeVersions', () => ({ getEmployeeVersion: jest.fn(), getEmployeeVersions: jest.fn() }));
jest.mock('@/utils/publicationError', () => ({ publicationErrorMessage: (error: unknown) => String(error) }));
const version = (id: string, prompt: string) => ({
  id,
  number: Number(id),
  name: '员工',
  authorId: '3',
  createdAt: '2026-10-29',
  configuration: { resourceName: '员工', corePersonaDefinition: prompt },
});

afterEach(() => jest.clearAllMocks());
it('loads two immutable versions and aligns/highlights their detail differences', async () => {
  (getEmployeeVersions as jest.Mock).mockResolvedValue({ versions: [version('1', '旧配置'), version('2', '新配置')] });
  (getEmployeeVersion as jest.Mock).mockImplementation((_resource, id) =>
    Promise.resolve(version(id, id === '1' ? '旧配置' : '新配置'))
  );
  const { container } = render(<Compare />);
  await waitFor(() => expect(screen.getByText('1 项差异')).toBeInTheDocument());
  expect(getEmployeeVersion).toHaveBeenCalledWith('10', '1');
  expect(getEmployeeVersion).toHaveBeenCalledWith('10', '2');
  expect(container.querySelectorAll('mark')).toHaveLength(2);
  expect(screen.getByText('修改')).toBeInTheDocument();
});
it('shows the real permission failure instead of mixing current employee details into the comparison', async () => {
  (getEmployeeVersions as jest.Mock).mockResolvedValue({ versions: [] });
  (getEmployeeVersion as jest.Mock).mockRejectedValue('管理权限已失效');
  render(<Compare />);
  await waitFor(() => expect(screen.getByText('管理权限已失效')).toBeInTheDocument());
  expect(screen.queryByText('核心人设与提示词')).not.toBeInTheDocument();
});

it('allows selecting versions beyond the first history page', async () => {
  (getEmployeeVersions as jest.Mock)
    .mockResolvedValueOnce({ versions: Array.from({ length: 20 }, (_, i) => version(String(i + 1), '配置')) })
    .mockResolvedValueOnce({ versions: [version('21', '更早配置')] });
  (getEmployeeVersion as jest.Mock).mockImplementation((_resource, id) => Promise.resolve(version(id, '配置')));
  render(<Compare />);
  fireEvent.click(await screen.findByText('加载更早版本'));
  await waitFor(() => expect(getEmployeeVersions).toHaveBeenCalledWith('10', 2));
  await waitFor(() => expect(screen.queryByText('加载更早版本')).not.toBeInTheDocument());
  fireEvent.mouseDown(screen.getByRole('combobox', { name: '左侧版本' }));
  fireEvent.change(screen.getByRole('combobox', { name: '左侧版本' }), { target: { value: 'V21' } });
  expect((await screen.findAllByText('V21 · 员工')).length).toBeGreaterThan(0);
});
