import { fireEvent, render, screen } from '@testing-library/react';
import ResourceCenter from '..';

const mockResourcesProps = jest.fn();

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
  default: (props: {
    resourceType: string;
    myResourcesOnly: boolean;
    onMyResourcesOnlyChange: (value: boolean) => void;
  }) => {
    mockResourcesProps(props);
    return (
      <div>
        {props.resourceType}
        <button onClick={() => props.onMyResourcesOnlyChange(!props.myResourcesOnly)}>
          {props.myResourcesOnly ? 'backToAll' : 'myResources'}
        </button>
      </div>
    );
  },
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
  beforeEach(() => {
    mockResourcesProps.mockClear();
  });

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

  it('passes the my resources state to each resource type', () => {
    render(<ResourceCenter />);

    expect(mockResourcesProps).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceType: 'SKILL',
        myResourcesOnly: false,
        onMyResourcesOnlyChange: expect.any(Function),
      })
    );
  });

  it.each([
    ['common.skill', 'SKILL'],
    ['resource.knowledge', 'KG_DOC'],
    ['common.tool', 'TOOL'],
  ])('hides module tabs in my resources and restores the %s selection on return', (label, resourceType) => {
    render(<ResourceCenter />);
    fireEvent.click(screen.getByRole('tab', { name: new RegExp(label) }));
    fireEvent.click(screen.getByRole('button', { name: 'myResources' }));

    expect(screen.queryByRole('tablist')).not.toBeInTheDocument();
    expect(screen.getByText(resourceType)).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'backToAll' }));
    expect(screen.getAllByRole('tab')).toHaveLength(4);
    expect(screen.getByRole('tab', { name: new RegExp(label) })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByText(resourceType)).toBeInTheDocument();
  });
});
