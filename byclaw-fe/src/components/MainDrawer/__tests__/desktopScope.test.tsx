import { act, fireEvent, render, screen } from '@testing-library/react';
import GlobalContext from '@/layout/components/provider/global';
import ToolCall from '@/components/MessagesComp/ToolCall';
import { EventEmitter$Cls } from '@/utils/eventEmitter';
import { useDesktopWorkspace } from '@/utils/desktopWorkspace';
import MainDrawer from '../index';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
// Keep the real nested drawers and tool entry; loading the remote desktop is the boundary.
jest.mock('@/components/DesktopWorkspace', () => ({
  __esModule: true,
  default: ({ owner }: { owner: string }) => <div data-testid="desktop-workspace">{owner}</div>,
}));

it('opens a tool desktop inside its application without replacing the enclosing drawer', () => {
  sessionStorage.clear();
  useDesktopWorkspace.setState({ owners: {}, activeOwner: '', visible: false, panel: '', revision: 0 });
  const outerEmitter = new EventEmitter$Cls();
  const applicationEmitter = new EventEmitter$Cls();
  const application = (
    <GlobalContext.Provider value={{ EventEmitter: applicationEmitter } as any}>
      <section aria-label="embedded application">
        <ToolCall
          message={{ sessionId: 'application-chat' }}
          messageListItemContent={{
            substance: { title: 'browser', status: '_DONE_' },
            instanceRefs: [{ sandboxId: 'application-sandbox', instance: 'vnc' }],
          }}
        />
        <MainDrawer />
      </section>
    </GlobalContext.Provider>
  );
  render(
    <GlobalContext.Provider value={{ EventEmitter: outerEmitter } as any}>
      <MainDrawer />
    </GlobalContext.Provider>
  );
  act(() => outerEmitter.emit('beyond-main-driver-open-type', { drawerType: application, title: 'Application' }));
  expect(screen.getByRole('region', { name: 'embedded application' })).toBeInTheDocument();

  fireEvent.click(screen.getByRole('button', { name: '查看桌面' }));

  expect(screen.getByRole('region', { name: 'embedded application' })).toBeInTheDocument();
  expect(screen.getAllByTestId('desktop-workspace')).toHaveLength(1);
  expect(screen.getByTestId('desktop-workspace')).toHaveTextContent(JSON.stringify(['session', 'application-chat']));
});
