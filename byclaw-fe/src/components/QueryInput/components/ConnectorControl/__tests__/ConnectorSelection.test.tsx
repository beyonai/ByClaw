import { fireEvent, render, screen } from '@testing-library/react';
import { useIntl } from '@umijs/max';
import enUS from '@/locales/en-US';
import zhCN from '@/locales/zh-CN';
import { ConnectorSelection, type Connector } from '..';

jest.mock('@umijs/max', () => ({ useIntl: jest.fn() }));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/service/connector', () => ({}));
jest.mock('../GlobalAccountSection', () => () => null);

const connectors: Connector[] = [
  { id: 1, code: 'dingtalk', name: 'DingTalk', description: '', authType: 'oauth', icon: null, enableFlag: 'Y' },
];

// 使用真实语言包验证悬浮提示、无障碍名称及运行时语言切换。
const setMessages = (messages: Record<string, string>) => {
  (useIntl as jest.Mock).mockReturnValue({ formatMessage: ({ id }: { id: string }) => messages[id] });
};

describe('ConnectorSelection localization', () => {
  it.each([
    { locale: 'en-US', messages: enUS, label: 'View connectors' },
    { locale: 'zh-CN', messages: zhCN, label: '查看连接器' },
  ])('localizes the tooltip and preserves opening in $locale', async ({ messages, label }) => {
    setMessages(messages);
    const onOpen = jest.fn();
    render(<ConnectorSelection value={connectors} onOpen={onOpen} />);

    const button = screen.getByRole('button', { name: label });
    fireEvent.mouseEnter(button);
    expect(await screen.findByRole('tooltip')).toHaveTextContent(label);
    fireEvent.click(button);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('updates the accessible name when the language changes', () => {
    setMessages(zhCN);
    const { rerender } = render(<ConnectorSelection value={connectors} />);
    expect(screen.getByRole('button', { name: '查看连接器' })).toBeInTheDocument();
    setMessages(enUS);
    rerender(<ConnectorSelection value={connectors} />);
    expect(screen.getByRole('button', { name: 'View connectors' })).toBeInTheDocument();
  });

  it.each([
    { locale: 'en-US', messages: enUS, label: 'Connected connectors' },
    { locale: 'zh-CN', messages: zhCN, label: '已连接连接器' },
  ])('localizes the static selection in $locale without adding a button', ({ messages, label }) => {
    setMessages(messages);
    render(<ConnectorSelection value={connectors} interactive={false} />);
    expect(screen.getByLabelText(label)).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('can render an empty selection before connectors become available', () => {
    setMessages(enUS);
    const { container, rerender } = render(<ConnectorSelection value={[]} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<ConnectorSelection value={connectors} />);
    expect(screen.getByRole('button', { name: 'View connectors' })).toBeInTheDocument();
  });
});
