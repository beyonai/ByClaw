import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { getPublicationCapabilities } from '@/service/employeePublication';
import PublicationEditionGuard from './EditionGuard';

let mockSearch = '?publicationId=100&appId=10';
const mockNavigate = jest.fn();
const mockLoadEditor = jest.fn();
jest.mock('@umijs/max', () => ({
  useLocation: () => ({ search: mockSearch }),
  useNavigate: () => mockNavigate,
}));
jest.mock('@/service/employeePublication', () => ({ getPublicationCapabilities: jest.fn() }));

function Editor() {
  mockLoadEditor();
  return <div>员工编辑器</div>;
}

beforeEach(() => {
  jest.clearAllMocks();
  (getPublicationCapabilities as jest.Mock).mockReset();
  mockSearch = '?publicationId=100&appId=10';
});

it('waits for an explicit enabled response before mounting the publication editor', async () => {
  let resolve!: (value: { enabled: boolean }) => void;
  (getPublicationCapabilities as jest.Mock).mockReturnValue(
    new Promise((done) => {
      resolve = done;
    })
  );
  render(
    <PublicationEditionGuard>
      <Editor />
    </PublicationEditionGuard>
  );
  expect(mockLoadEditor).not.toHaveBeenCalled();
  await act(async () => {
    resolve({ enabled: true });
  });
  expect(await screen.findByText('员工编辑器')).toBeInTheDocument();
});

it.each([{ enabled: false }, {}, null])(
  'blocks disabled or unknown editions even through an old publication link',
  async (capabilities) => {
    (getPublicationCapabilities as jest.Mock).mockResolvedValue(capabilities);
    render(
      <PublicationEditionGuard>
        <Editor />
      </PublicationEditionGuard>
    );
    await screen.findByText('当前版本不支持发布到官方推荐');
    expect(mockLoadEditor).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: '返回员工列表' }));
    expect(mockNavigate).toHaveBeenCalledWith('/myEmployees');
  }
);

it('allows retry after a capability failure without mounting the publication editor', async () => {
  (getPublicationCapabilities as jest.Mock)
    .mockRejectedValueOnce(new Error('offline'))
    .mockResolvedValue({ enabled: true });
  render(
    <PublicationEditionGuard>
      <Editor />
    </PublicationEditionGuard>
  );
  await screen.findByText('暂时无法确认发布功能是否可用');
  expect(mockLoadEditor).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole('button', { name: /重\s*试/ }));
  await screen.findByText('员工编辑器');
  await waitFor(() => expect(getPublicationCapabilities).toHaveBeenCalledTimes(2));
});

it('keeps normal employee editing independent from publication availability', () => {
  mockSearch = '?appId=10';
  render(
    <PublicationEditionGuard>
      <Editor />
    </PublicationEditionGuard>
  );
  expect(screen.getByText('员工编辑器')).toBeInTheDocument();
  expect(getPublicationCapabilities).not.toHaveBeenCalled();
});
