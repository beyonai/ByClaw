import { fireEvent, render, screen } from '@testing-library/react';
import ResourceToolMenu from '..';
import { ResourceType } from '../../../RichInput/utils/constants';

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
  useSelector: () => ({}),
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/layout/sider/components/EmployeeList', () => () => null);
jest.mock('@/components/ChatLayoutComp/ChatResourceWorkspace/FileResourcePanel', () => () => null);
jest.mock('../../ConnectorControl', () => () => null);
jest.mock('../../../RichInput/mentionPopover/resourceTabsCompact', () => () => null);
jest.mock('../FilePicker', () => ({ onSelect }: any) => (
  <button onClick={() => onSelect({ id: '/notes.md' }, 'COMMON_FILE')}>quote file</button>
));

describe('resource menu local shared tab', () => {
  it.each([undefined, 'existing-session'])('supports selecting files in session %s', (sessionId) => {
    const onSelect = jest.fn();
    render(<ResourceToolMenu sessionId={sessionId} onSelect={onSelect} />);
    expect(screen.queryByText('quote file')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'chatResource.localSharedFile' }));
    fireEvent.click(screen.getByRole('button', { name: 'quote file' }));
    expect(onSelect).toHaveBeenCalledWith({ id: '/notes.md' }, ResourceType.commonFile);
  });
});
