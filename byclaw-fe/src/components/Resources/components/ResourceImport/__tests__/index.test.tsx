jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
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

describe('ResourceImport', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockCheckSkillImportConflicts.mockResolvedValue({ total: 0, success: 0, failed: 0, items: [] });
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
      target: { files: [new File(['skill bundle'], 'skills.zip', { type: 'application/zip' })] },
    });
    fireEvent.click(screen.getByRole('button', { name: 'knowledgeCenter.import.confirm' }));

    await screen.findByRole('button', { name: 'resource.import.finish' });
    fireEvent.click(screen.getByRole('button', { name: 'resource.import.finish' }));

    await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(result));
    expect(onSuccess).toHaveBeenCalledTimes(1);
  });

  it('invokes onCancel without invoking onSuccess', () => {
    const onCancel = jest.fn();
    const onSuccess = jest.fn();

    render(<ResourceImport {...defaultProps} onCancel={onCancel} onSuccess={onSuccess} />);

    fireEvent.click(screen.getByRole('button', { name: 'close import' }));

    expect(onCancel).toHaveBeenCalledTimes(1);
    expect(onSuccess).not.toHaveBeenCalled();
  });
});
