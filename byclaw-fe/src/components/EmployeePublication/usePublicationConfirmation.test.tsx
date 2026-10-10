import { act, fireEvent, render, screen, within } from '@testing-library/react';
import usePublicationConfirmation from './usePublicationConfirmation';
import type { PublicationDetail } from '@/service/employeePublication';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';
jest.mock('@umijs/max', () => ({
  getDvaApp: jest.fn(),
  useIntl: () => require('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

const originalPublicPath = window.publicPath;
beforeEach(() => {
  mockLocale = 'zh-CN';
  delete (window as Window & { publicPath?: string }).publicPath;
});
afterEach(() => {
  if (originalPublicPath === undefined) {
    delete (window as Window & { publicPath?: string }).publicPath;
  } else {
    window.publicPath = originalPublicPath;
  }
});

let confirm: ReturnType<typeof usePublicationConfirmation>['confirmPublication'];
function Confirmation() {
  const result = usePublicationConfirmation();
  confirm = result.confirmPublication;
  return result.confirmationDialog;
}
const detail = {
  publication: { requestId: '100', employeeName: '客服(企业)' },
  dependencies: [
    {
      resourceId: '20',
      name: '个人客户库',
      action: 'OMIT_RESOURCE',
      resourceType: 'KG_DOC',
      warning: '个人知识不带入',
    },
    {
      resourceId: '21',
      name: '客户分析技能',
      action: 'OMIT_RESOURCE',
      resourceType: 'SKILL',
      warning: '客户查询工具：个人工具',
    },
    { resourceId: '*', name: '全部工具', action: 'BUILTIN_TOOL', resourceType: 'TOOL' },
    { resourceId: '22', name: '文本分析', action: 'COPY_SKILL', resourceType: 'SKILL' },
    {
      resourceId: '23',
      name: '部门知识库',
      action: 'REFERENCE_RESOURCE',
      resourceType: 'KG_DOC',
      warning: '仅授权用户可用',
    },
  ],
} as PublicationDetail;

it('explains exact omissions separately from retained restrictions and permits publishing', async () => {
  render(<Confirmation />);
  let pending: ReturnType<typeof confirm>;
  act(() => {
    pending = confirm(detail);
  });
  const dialog = within(await screen.findByRole('dialog', { name: '确认发布到企业' }));
  expect(dialog.getByText('发布后保留 3 项资源，2 项不会带入')).toBeInTheDocument();
  expect(dialog.getByText('个人客户库')).toBeInTheDocument();
  expect(dialog.getByText('客户查询工具：个人工具')).toBeInTheDocument();
  expect(dialog.getAllByText('不会带入')).toHaveLength(2);
  expect(dialog.getByText('保留关联，但使用范围受限（1 项）')).toBeInTheDocument();
  expect(dialog.getByText('部门知识库')).toBeInTheDocument();
  fireEvent.click(dialog.getByText('查看其余资源（2 项，无使用限制提醒）'));
  expect(await dialog.findByText('全部工具')).toBeInTheDocument();
  expect(dialog.getByText('生成企业技能副本')).toBeInTheDocument();
  const submit = dialog.getByRole('button', { name: '确认并继续发布' });
  expect(submit).toBeEnabled();
  await act(async () => {
    fireEvent.click(submit);
    expect(await pending).toBe('publish');
  });
});

it('allows publishing an employee even when every associated resource is omitted', async () => {
  render(<Confirmation />);
  let pending: ReturnType<typeof confirm>;
  act(() => {
    pending = confirm({ ...detail, dependencies: detail.dependencies.slice(0, 2) });
  });
  expect(await screen.findByText('发布后保留 0 项资源，2 项不会带入')).toBeInTheDocument();
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '确认并继续发布' }));
    expect(await pending).toBe('publish');
  });
});

it('returns to editing without consenting to publication', async () => {
  render(<Confirmation />);
  let pending: ReturnType<typeof confirm>;
  act(() => {
    pending = confirm(detail);
  });
  await screen.findByRole('dialog');
  await act(async () => {
    fireEvent.click(screen.getByRole('button', { name: '返回修改' }));
    expect(await pending).toBe('edit');
  });
});

it.each([
  [undefined, '/'],
  ['/', '/'],
  ['/beyond/', '/beyond/'],
  ['/beyond', '/beyond/'],
  ['/tenant/portal/', '/tenant/portal/'],
])(
  'opens the read-only official target under runtime publicPath %s and requires renewed confirmation after a change',
  async (publicPath, prefix) => {
    if (publicPath !== undefined) window.publicPath = publicPath;
    render(<Confirmation />);
    let pending: ReturnType<typeof confirm>;
    act(() => {
      pending = confirm({
        ...detail,
        updateTarget: { resourceId: '90', name: '官方客服(企业)', fromPersonal: true, changed: true },
      });
    });
    const dialog = within(await screen.findByRole('dialog'));
    expect(dialog.getByText(/企业副本单独调整过的这些内容也可能被替换/)).toBeInTheDocument();
    expect(dialog.getByText('官方员工配置已变化，需要重新确认')).toBeInTheDocument();
    const officialLink = dialog.getByRole('link', { name: '查看当前官方配置' });
    expect(officialLink).toHaveAttribute(
      'href',
      `${prefix}digitalEmployeesCreate?appId=90&readOnly=true&log=false&manage=false`
    );
    expect(officialLink).toHaveAttribute('target', '_blank');
    expect(officialLink).toHaveAttribute('rel', 'noopener noreferrer');
    expect(dialog.getByRole('button', { name: '确认并继续发布' })).toBeDisabled();
    await act(async () => {
      fireEvent.click(dialog.getByRole('button', { name: '返回修改' }));
      expect(await pending).toBe('edit');
    });
  }
);

it('localizes confirmation summaries, resource restrictions and publication actions in English', async () => {
  mockLocale = 'en-US';
  render(<Confirmation />);
  let decision!: ReturnType<typeof confirm>;
  act(() => {
    decision = confirm(detail);
  });
  const dialog = within(await screen.findByRole('dialog', { name: 'Confirm publication to enterprise' }));
  expect(dialog.getByText('Resources retained after publication: 3; excluded: 2')).toBeInTheDocument();
  expect(dialog.getByText('Retained links with restricted access (1)')).toBeInTheDocument();
  fireEvent.click(dialog.getByRole('button', { name: 'Confirm and continue publishing' }));
  await expect(decision).resolves.toBe('publish');
});
