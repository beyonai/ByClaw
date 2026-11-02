import { fireEvent, render, screen, within } from '@testing-library/react';
import ServiceSpecCatalog from '../ServiceSpecCatalog';
import { type ServiceSpecConfig } from '../serviceSpecUtils';

jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

const specs: ServiceSpecConfig[] = [
  { serviceKey: 'user-agent', specJson: '{}', ownerScope: 'USER', enabled: 1 },
  { serviceKey: 'tenant-agent', specJson: '{}', ownerScope: 'TENANT', enabled: 1 },
  { serviceKey: 'shared-agent', specJson: '{}', ownerScope: 'SHARED', enabled: 1 },
  ...['browser', 'media'].map((key) => ({
    serviceKey: `tools-${key}`,
    displayName: `${key} workspace`,
    ownerScope: 'TENANT',
    enabled: 1,
    specJson: JSON.stringify({
      runtimeOptions: {
        lifecycle: { autoStart: 'true' },
        toolSandbox: {
          contract: 'byclaw.tool-sandbox/v1',
          description: `${key} automation`,
          capabilities: JSON.stringify([key]),
          enabled: key === 'browser' ? 'true' : 'false',
        },
      },
    }),
  })),
];

const setup = (dimension: 'USER' | 'TENANT' | 'SHARED' | 'TOOL' = 'TOOL') => {
  const actions = {
    onAdd: jest.fn(),
    onEdit: jest.fn(),
    onDelete: jest.fn(),
    onEnabledChange: jest.fn(),
    onAutoStartChange: jest.fn(),
    onDimensionChange: jest.fn(),
  };
  const view = render(
    <ServiceSpecCatalog specs={specs} loading={false} dimension={dimension} updatingKey={null} {...actions} />
  );
  return { ...view, ...actions };
};

test('searches market titles, descriptions and capability labels and opens actual template details', () => {
  setup();
  expect(screen.getByText('browser workspace')).toBeInTheDocument();
  expect(screen.queryByText('tenant-agent')).not.toBeInTheDocument();
  fireEvent.change(screen.getByRole('textbox', { name: 'sandboxMgr.market.search' }), {
    target: { value: 'media automation' },
  });
  expect(screen.queryByText('browser workspace')).not.toBeInTheDocument();
  expect(screen.getByText('media workspace')).toBeInTheDocument();
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.market.details/ }));
  const dialog = screen.getByRole('dialog');
  expect(within(dialog).getByText('tools-media')).toBeInTheDocument();
  expect(within(dialog).getByText('media automation')).toBeInTheDocument();
});

test('tool card switches availability instead of login startup and preserves the selected record', () => {
  const actions = setup();
  fireEvent.click(screen.getByRole('switch', { name: 'browser workspace sandboxMgr.market.enabled' }));
  expect(actions.onEnabledChange).toHaveBeenCalledWith(specs[3], false);
  expect(actions.onAutoStartChange).not.toHaveBeenCalled();
  expect(screen.getByRole('switch', { name: 'media workspace sandboxMgr.market.enabled' })).not.toBeChecked();
});

test('only user specifications expose the login startup control', () => {
  const user = setup('USER');
  expect(screen.getByRole('switch', { name: 'user-agent sandboxMgr.config.autoStart' })).toBeInTheDocument();
  user.unmount();
  setup('TENANT');
  expect(screen.queryByText('sandboxMgr.config.autoStart')).not.toBeInTheDocument();
  expect(screen.getByRole('switch', { name: 'tenant-agent sandboxMgr.market.enabled' })).toBeInTheDocument();
});

test('the four tabs select dimensions and add templates in the current dimension', () => {
  const actions = setup();
  fireEvent.click(screen.getByRole('tab', { name: /sandboxMgr.dimension.SHARED/ }));
  expect(actions.onDimensionChange).toHaveBeenCalledWith('SHARED');
  fireEvent.click(screen.getByRole('button', { name: /sandboxMgr.config.add/ }));
  expect(actions.onAdd).toHaveBeenCalledWith('TOOL');
});
