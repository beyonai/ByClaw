import React from 'react';
import { render, screen } from '@testing-library/react';

import KnowledgeBaseListItem from '../KnowledgeBaseListItem';

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: ({ type }: { type: string }) => <span data-testid={type} />,
}));

jest.mock('@/utils', () => ({
  getRuntimeActualUrl: (url: string) => url,
}));

describe('KnowledgeBaseListItem', () => {
  it('renders compact list text instead of a heading', () => {
    render(
      <KnowledgeBaseListItem
        item={
          {
            resourceId: 'knowledge-resource-1',
            resourceName: '平台管理员adminvip的个人知识库',
            resourceDesc: '平台管理员adminvip的个人知识库',
            resourceBizType: 'KG_DOC',
          } as any
        }
      />
    );

    expect(screen.getAllByText('平台管理员adminvip的个人知识库').length).toBeGreaterThan(0);
    expect(screen.queryByRole('heading', { level: 1 })).not.toBeInTheDocument();
  });
});
