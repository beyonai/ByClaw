import { fireEvent, render, screen } from '@testing-library/react';
import ResourceCenter from '..';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('@/components/AntdIcon', () => ({
  __esModule: true,
  default: () => null,
}));

jest.mock('@/components/Resources', () => ({
  __esModule: true,
  default: ({ resourceType }: { resourceType: string }) => <div>{resourceType}</div>,
}));

jest.mock('@/pages/models', () => ({
  __esModule: true,
  default: () => <div>ModelsPage</div>,
}));

jest.mock('@/pages/files', () => ({
  __esModule: true,
  default: () => <div>FilesPage</div>,
}));

describe('ResourceCenter', () => {
  it('hides the file module while keeping the other resource tabs available', () => {
    render(<ResourceCenter />);

    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.queryByRole('tab', { name: /common.file/ })).not.toBeInTheDocument();
    expect(screen.getByText('SKILL')).toBeInTheDocument();
    expect(screen.queryByText('FilesPage')).not.toBeInTheDocument();

    const tabs = [
      { label: 'resource.knowledge', content: 'KG_DOC' },
      { label: 'common.tool', content: 'TOOL' },
      { label: 'common.model', content: 'ModelsPage' },
      { label: 'common.skill', content: 'SKILL' },
    ];

    tabs.forEach(({ label, content }) => {
      fireEvent.click(screen.getByRole('tab', { name: new RegExp(label) }));
      expect(screen.getByText(content)).toBeInTheDocument();
      expect(screen.queryByText('FilesPage')).not.toBeInTheDocument();
    });
  });
});
