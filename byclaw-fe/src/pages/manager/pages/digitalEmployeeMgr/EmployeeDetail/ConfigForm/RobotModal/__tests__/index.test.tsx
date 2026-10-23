import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { ConfigProvider } from 'antd';

import type { RobotConfig } from '../../robotConfig';
import RobotModal from '../index';

let mockLocale: 'zh-CN' | 'en-US' = 'zh-CN';

jest.mock('@umijs/max', () => ({
  useIntl: () => jest.requireActual('@/testUtils/localeIntl').getLocaleIntl(mockLocale),
}));

const robotChannelLabelMap = { DingTalk: 'DingTalk', Feishu: 'Feishu', WeCom: 'WeCom' };

function renderRobotModal(item: RobotConfig = {}, onOk?: (item: RobotConfig) => void) {
  const handleOk = onOk ?? jest.fn();

  return render(
    <ConfigProvider theme={{ token: { motion: false } }}>
      <RobotModal
        open
        setOpen={jest.fn()}
        onOk={handleOk}
        robotChannelLabelMap={robotChannelLabelMap}
        item={item}
        isReadOnly={false}
      />
    </ConfigProvider>
  );
}

describe('DingTalk robot binding hint', () => {
  beforeEach(() => {
    mockLocale = 'zh-CN';
  });

  it.each([
    { locale: 'zh-CN' as const, hint: '同一机器人的robotCode仅可绑定一个数字员工' },
    { locale: 'en-US' as const, hint: 'Each robotCode can be bound to only one digital employee' },
  ])('shows the binding restriction beside robotCode in $locale', async ({ locale, hint }) => {
    mockLocale = locale;
    renderRobotModal({ channel: 'DingTalk' });

    await waitFor(() => expect(screen.getByText(hint)).toBeVisible());
    expect(screen.getByRole('textbox', { name: /robotCode/ })).toHaveAccessibleDescription(hint);
  });

  it('only shows the binding restriction on the DingTalk tab', async () => {
    renderRobotModal();
    const hint = '同一机器人的robotCode仅可绑定一个数字员工';

    await waitFor(() => expect(screen.getByText(hint)).toBeVisible());
    fireEvent.click(screen.getByRole('tab', { name: 'Feishu' }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'WeCom' }));
    expect(screen.queryByText(hint)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('tab', { name: 'DingTalk' }));
    await waitFor(() => expect(screen.getByText(hint)).toBeVisible());
  });

  it('keeps the hint visible when editing and preserves the submitted credentials', async () => {
    const onOk = jest.fn();
    const item = {
      channel: 'DingTalk',
      clientId: 'client-1',
      clientSecret: 'secret-1',
      robotCode: 'robot-1',
    };
    renderRobotModal(item, onOk);

    await waitFor(() => expect(screen.getByText('同一机器人的robotCode仅可绑定一个数字员工')).toBeVisible());
    expect(screen.getByRole('textbox', { name: /robotCode/ })).toHaveValue('robot-1');

    // 弹窗使用 AntD 默认按钮文案，按角色定位以兼容默认中文按钮的空格排版。
    fireEvent.click(screen.getByRole('button', { name: /OK|确\s*定/ }));

    await waitFor(() => expect(onOk).toHaveBeenCalledWith(expect.objectContaining(item)));
  });
});
