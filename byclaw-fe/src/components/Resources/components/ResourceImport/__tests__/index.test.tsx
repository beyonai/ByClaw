import JSZip from 'jszip';
jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }, values?: Record<string, number>) =>
      id === 'resource.import.skillPublicationSummary'
        ? `${id}:${values?.publishedCount}/${values?.pendingReviewCount}/${values?.failedCount}`
        : id,
  }),
}));

const mockForm = {
  resetFields: jest.fn(),
  validateFields: jest.fn(),
};

jest.mock('antd', () => {
  const Button = ({ children, onClick, disabled, className }: any) => (
    <button type="button" onClick={onClick} disabled={disabled} className={className}>
      {children}
    </button>
  );

  return {
    Alert: ({ message, description }: any) => (
      <div>
        {message}
        {description}
      </div>
    ),
    Button,
    Form: Object.assign(({ children }: any) => <form>{children}</form>, {
      Item: ({ children }: any) => <div>{children}</div>,
      useForm: () => [mockForm],
    }),
    Modal: Object.assign(
      ({ children, footer, onCancel }: any) => (
        <div role="dialog">
          <button type="button" aria-label="close import" onClick={onCancel} />
          {children}
          {footer}
        </div>
      ),
      { confirm: jest.fn() }
    ),
    Tabs: ({ items }: any) => (
      <div>
        {items.map((item: any) => (
          <div key={item.key}>{item.children}</div>
        ))}
      </div>
    ),
    Table: () => null,
    TreeSelect: () => null,
    Upload: {
      Dragger: ({ beforeUpload, children }: any) => (
        <div>
          <input
            aria-label="skill zip"
            type="file"
            onChange={(event) => {
              const files = Array.from(event.target.files || []);
              if (files[0]) {
                beforeUpload(files[0], files);
              }
            }}
          />
          {children}
        </div>
      ),
    },
    message: {
      error: jest.fn(),
      success: jest.fn(),
      warning: jest.fn(),
    },
  };
});

jest.mock('@ant-design/icons', () => ({
  CloseOutlined: () => null,
  DownloadOutlined: () => null,
  LoadingOutlined: () => null,
}));

jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/pages/manager/service/DigitalEmployeeMgr', () => ({ parseCurl: jest.fn() }));
jest.mock('@/utils', () => ({ getRuntimeActualUrl: jest.fn(() => '') }));
jest.mock('@/pages/manager/service/resources', () => ({
  checkSkillImportConflicts: jest.fn(),
  importResource: jest.fn(),
}));

import React from 'react';
import { Modal } from 'antd';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import ResourceImport from '..';
import type { ResourceImportResult } from '@/pages/manager/service/resources';
import { checkSkillImportConflicts, importResource } from '@/pages/manager/service/resources';

const mockCheckSkillImportConflicts = checkSkillImportConflicts as jest.Mock;
const mockImportResource = importResource as jest.Mock;

const defaultProps = {
  visible: true,
  resourceName: '技能',
  resourceType: 'SKILL',
  catalogId: 'catalog-1',
  catalogList: [],
  activeTab: 'personal',
  saveTool: jest.fn(),
};

const createSkillFile = async (name: string) =>
  new File([await new JSZip().file('SKILL.md', 'description: Demo').generateAsync({ type: 'blob' })], name, {
    type: 'application/zip',
  });

describe('ResourceImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckSkillImportConflicts.mockResolvedValue({ total: 0, success: 0, failed: 0, items: [] });
  });

  it.each([false, true])('distinguishes published and pending imports (pending=%s)', async (pending) => {
    const item = {
      resourceId: 'skill-1',
      resourceCode: 'demo',
      resourceName: 'Demo',
      updated: false,
      success: true,
      reviewRequired: pending,
    };
    mockImportResource.mockResolvedValue({
      total: 2,
      success: 1,
      failed: 1,
      createdCount: 1,
      createdItems: [item],
      items: [item, { resourceCode: 'bad', resourceName: 'Bad', success: false, message: 'invalid package' }],
    });
    render(<ResourceImport {...defaultProps} activeTab="enterprise" onCancel={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('skill zip'), {
      target: { files: [await createSkillFile('demo.zip')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));
    expect(
      await screen.findByText(`resource.import.skillPublicationSummary:${pending ? '0/1' : '1/0'}/1`)
    ).toBeInTheDocument();
    expect(screen.queryByText(/resource.import.skillReviewHint/) !== null).toBe(pending);
    expect(mockImportResource.mock.calls[0][2].get('ownerType')).toBe('enterprise');
  });

  it('explains that an overwrite awaits review before importing', async () => {
    const item = {
      resourceId: 'old',
      resourceCode: 'demo',
      resourceName: 'Demo',
      updated: true,
      success: true,
      reviewRequired: true,
    };
    mockCheckSkillImportConflicts.mockResolvedValue({
      total: 1,
      success: 1,
      failed: 0,
      items: [item],
      updatedItems: [item],
    });
    mockImportResource.mockResolvedValue({ total: 1, success: 1, failed: 0, items: [item], updatedItems: [item] });
    (Modal.confirm as jest.Mock).mockImplementationOnce(({ content, onOk }) => {
      render(content);
      expect(screen.getByText('resource.import.skillReviewOverwriteConfirmDesc')).toBeInTheDocument();
      onOk();
    });
    render(<ResourceImport {...defaultProps} activeTab="enterprise" onCancel={jest.fn()} onSuccess={jest.fn()} />);
    fireEvent.change(screen.getByLabelText('skill zip'), {
      target: { files: [await createSkillFile('demo.zip')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));
    await screen.findByText('resource.import.skillPublicationSummary:0/1/0');
    expect(Modal.confirm).toHaveBeenCalledTimes(1);
  });

  it('returns the completed SKILL import summary through onSuccess', async () => {
    const result: ResourceImportResult = {
      total: 2,
      success: 1,
      failed: 1,
      createdCount: 1,
      updatedCount: 0,
      zipFileName: 'skills.zip',
      createdItems: [
        {
          resourceId: 'skill-1',
          resourceCode: 'data-query',
          resourceName: '数据查询',
          updated: false,
          success: true,
        },
      ],
      updatedItems: [],
      items: [
        {
          resourceId: 'skill-1',
          resourceCode: 'data-query',
          resourceName: '数据查询',
          updated: false,
          success: true,
        },
        {
          resourceCode: 'chart-builder',
          resourceName: '图表生成',
          updated: false,
          success: false,
          message: '版本不兼容',
        },
      ],
    };
    const onSuccess = jest.fn();
    mockImportResource.mockResolvedValue(result);

    render(<ResourceImport {...defaultProps} onCancel={jest.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('skill zip'), {
      target: { files: [await createSkillFile('skills.zip')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));

    await screen.findByRole('button', { name: 'resource.import.finish' });
    fireEvent.click(screen.getByRole('button', { name: 'resource.import.finish' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('does not return a failed SKILL preflight summary as a completed import result', async () => {
    const preflightResult: ResourceImportResult = {
      total: 1,
      success: 0,
      failed: 1,
      items: [
        {
          resourceCode: 'invalid-skill',
          resourceName: '无效技能',
          updated: false,
          success: false,
          message: '技能包校验失败',
        },
      ],
    };
    const onSuccess = jest.fn();
    mockCheckSkillImportConflicts.mockResolvedValue(preflightResult);

    render(<ResourceImport {...defaultProps} onCancel={jest.fn()} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('skill zip'), {
      target: { files: [await createSkillFile('invalid.zip')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));

    await screen.findByRole('button', { name: 'resource.import.finish' });
    expect(mockImportResource).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'resource.import.finish' }));

    expect(onSuccess).toHaveBeenCalledWith(undefined);
    expect(onSuccess).not.toHaveBeenCalledWith(preflightResult);
  });

  it('cancels a failed SKILL preflight summary without invoking onSuccess', async () => {
    mockCheckSkillImportConflicts.mockResolvedValue({
      total: 1,
      success: 0,
      failed: 1,
      items: [
        {
          resourceCode: 'invalid-skill',
          resourceName: '无效技能',
          updated: false,
          success: false,
          message: '技能包校验失败',
        },
      ],
    } satisfies ResourceImportResult);
    const onCancel = jest.fn();
    const onSuccess = jest.fn();

    render(<ResourceImport {...defaultProps} onCancel={onCancel} onSuccess={onSuccess} />);

    fireEvent.change(screen.getByLabelText('skill zip'), {
      target: { files: [await createSkillFile('invalid.zip')] },
    });
    await waitFor(() => expect(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' })).toBeEnabled());
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));

    await screen.findByRole('button', { name: 'resource.import.finish' });
    fireEvent.click(screen.getByRole('button', { name: 'common.cancel' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});

it('restores original ZIP names before both conflict checking and importing an export bundle', async () => {
  jest.clearAllMocks();
  const bundle = new JSZip();
  bundle.file('packages/0.zip', await createSkillFile('one.zip'));
  bundle.file('packages/1.zip', await createSkillFile('two.zip'));
  bundle.file(
    'byclaw-skills.json',
    JSON.stringify({
      format: 'byclaw-skill-packages-v1',
      packages: [
        { path: 'packages/0.zip', fileName: 'one.zip' },
        { path: 'packages/1.zip', fileName: 'two.zip' },
      ],
    })
  );
  mockCheckSkillImportConflicts.mockResolvedValue({ items: [], updatedItems: [] });
  mockImportResource.mockResolvedValue({ items: [], updatedItems: [], createdItems: [] });
  render(<ResourceImport {...defaultProps} onCancel={jest.fn()} onSuccess={jest.fn()} />);
  fireEvent.change(screen.getByLabelText('skill zip'), {
    target: { files: [new File([await bundle.generateAsync({ type: 'blob' })], 'skills.zip')] },
  });
  await screen.findByText('one.zip');
  await screen.findByText('two.zip');
  fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));
  await waitFor(() => expect(mockImportResource).toHaveBeenCalled());
  const preflight = mockCheckSkillImportConflicts.mock.calls[
    mockCheckSkillImportConflicts.mock.calls.length - 1
  ][0] as FormData;
  const imported = mockImportResource.mock.calls[mockImportResource.mock.calls.length - 1][2] as FormData;
  expect((preflight.getAll('file') as File[]).map((file) => file.name)).toEqual(['one.zip', 'two.zip']);
  expect(imported.getAll('file')).toEqual(preflight.getAll('file'));
});
