import { act, fireEvent, render, screen, within } from '@testing-library/react';
import { readFileSync, readdirSync } from 'fs';
import { resolve } from 'path';
import commonStyles from '@/pages/manager/less/commonTabList.less';
import ModelMgr from '../../index';
import styles from '../../index.module.less';

const mockDispatch = jest.fn();
const mockIntl = { formatMessage: ({ id }: { id: string }) => id };

jest.mock('@umijs/max', () => ({
  useIntl: () => mockIntl,
  getLocale: () => 'zh-CN',
  useDispatch: () => mockDispatch,
  useSelector: () => false,
}));
jest.mock('@/pages/manager/service/System', () => ({
  getByParamGroupCode: () => Promise.resolve({
    data: { byaiSystemConfigLists: [{ paramValue: 'CUSTOM', paramName: '自定义类型' }] },
  }),
}));
jest.mock('@/pages/manager/service/session', () => ({
  getDcSystemConfigListByStandType: () => Promise.resolve({ data: [] }),
}));
jest.mock('@/pages/manager/hooks/useShowModal', () => ({
  __esModule: true,
  default: () => [{}, { handleShow: jest.fn(), onCancel: jest.fn() }],
}));
jest.mock('../ModelFormModal', () => () => null);
jest.mock('../ModelCardItem', () => () => null);
// 保留真实列表容器，验证滚动监听与 ref 确实绑定到列表区域。
jest.mock('@/pages/manager/components/CardList', () => ({ dataSource }: any) => (
  <div data-testid="model-cards">
    {dataSource.map((item: { id: string }) => (
      <div key={item.id}>{item.id}</div>
    ))}
  </div>
));
jest.mock('../ModelHeroPanel', () => ({ onReset, activeFilterCount }: any) => (
  <button onClick={onReset} disabled={!activeFilterCount}>
    Reset
  </button>
));

describe('model list queries and scrolling', () => {
  beforeEach(() => {
    mockDispatch.mockClear();
    // 同步执行首屏响应后的滚动复位，避免动画帧影响触底场景。
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((callback) => {
      callback(0);
      return 0;
    });
  });

  afterEach(() => jest.restoreAllMocks());

  it('applies height constraints to the list parent when shared CSS Module classes are scoped', async () => {
    // 事件测试不能发现父容器被内容撑高的问题，这里加载真实样式校验高度约束是否命中实际节点。
    const pnpmDirectory = resolve(__dirname, '../../../../../../../node_modules/.pnpm');
    const lessPackage = readdirSync(pnpmDirectory).find((name) => name.startsWith('less@'));
    if (!lessPackage) throw new Error('The installed Umi dependencies must include Less');
    const less = require(resolve(pnpmDirectory, lessPackage, 'node_modules/less'));
    const filename = resolve(__dirname, '../../index.module.less');
    const { css } = await less.render(readFileSync(filename, 'utf8'), {
      filename,
      modifyVars: { antPrefix: 'beyond' },
    });
    const stylesheet = document.createElement('style');
    // 展开 CSS Modules 的全局标记，让旧的全局 tabContent 规则也参与匹配，避免误判。
    stylesheet.textContent = css.replace(/:global\s+/g, '');
    document.head.appendChild(stylesheet);

    try {
      const { container } = render(<ModelMgr />);
      await act(async () => {});
      const list = container.querySelector<HTMLElement>(`.${styles.cardList}`)!;
      const content = list.parentElement!;
      // identity-obj-proxy 会掩盖跨样式模块的类名差异，模拟共享 tabContent 在浏览器中的独立类名。
      content.classList.replace(commonStyles.tabContent, 'shared_tabContent_scoped');

      const contentStyle = window.getComputedStyle(content);
      expect(contentStyle.display).toBe('flex');
      expect(contentStyle.flexDirection).toBe('column');
      expect(contentStyle.flexGrow).toBe('1');
      expect(parseFloat(contentStyle.minHeight)).toBe(0);
      expect(contentStyle.overflow).toBe('hidden');
      expect(window.getComputedStyle(list).overflowY).toBe('auto');
    } finally {
      stylesheet.remove();
    }
  });

  it('keeps the selected type during pagination and clears it with All or reset', async () => {
    const { container } = render(<ModelMgr />);
    await act(async () => {});
    const group = within(screen.getByRole('group', { name: 'modelMgr.filterModelType' }));
    const choose = () =>
      fireEvent.click(group.getAllByText('自定义类型').find((item) => !item.closest('[aria-hidden="true"]'))!);
    const latestRequest = () => mockDispatch.mock.calls[mockDispatch.mock.calls.length - 1][0];

    // 接口新增的类型无需改动前端即可显示并透传查询。
    choose();
    expect(latestRequest().payload).toMatchObject({ pageNum: 1, modelType: 'CUSTOM' });
    act(() => latestRequest().success({ rows: [{ id: 'tts-1' }], total: 13, pageIndex: 1, pageSize: 12 }));
    fireEvent.scroll(container.querySelector(`.${styles.cardList}`)!);
    expect(latestRequest().payload).toMatchObject({ pageNum: 2, modelType: 'CUSTOM' });

    fireEvent.click(group.getByRole('img', { name: 'close-circle' }));
    expect(latestRequest().payload).toMatchObject({ pageNum: 1, modelType: undefined });
    choose();
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    expect(latestRequest().payload).toMatchObject({ pageNum: 1, modelType: undefined });
    expect(group.getAllByText('自定义类型').find((item) => !item.closest('[aria-hidden="true"]'))).toBeVisible();
    expect(screen.getByRole('button', { name: 'Reset' })).toBeDisabled();
  });

  it('loads more only near the list bottom and keeps the toolbar outside the scrolling area', async () => {
    const { container } = render(<ModelMgr />);
    await act(async () => {});
    const firstRequest = mockDispatch.mock.calls.find(([request]) => request.payload?.pageSize === 12)![0];
    const rows = Array.from({ length: 12 }, (_, index) => ({ id: `model-${index}` }));
    act(() => firstRequest.success({ rows, total: 13, pageIndex: 1, pageSize: 12 }));

    const list = container.querySelector<HTMLElement>(`.${styles.cardList}`)!;
    expect(list).toContainElement(screen.getByTestId('model-cards'));
    expect(list).not.toContainElement(screen.getByRole('button', { name: 'Reset' }));
    expect(list).not.toContainElement(screen.getByRole('group', { name: 'modelMgr.filterModelType' }));
    // JSDOM 不计算布局，显式给出列表尺寸来验证触底阈值。
    Object.defineProperties(list, {
      scrollHeight: { configurable: true, value: 1200 },
      clientHeight: { configurable: true, value: 400 },
    });
    mockDispatch.mockClear();
    fireEvent.scroll(container.firstChild as HTMLElement);
    fireEvent.scroll(list, { target: { scrollTop: 719 } });
    expect(mockDispatch).not.toHaveBeenCalled();

    fireEvent.scroll(list, { target: { scrollTop: 720 } });
    expect(mockDispatch).toHaveBeenCalledTimes(1);
    const nextRequest = mockDispatch.mock.calls[0][0];
    expect(nextRequest.payload).toMatchObject({ pageNum: 2, pageSize: 12 });
    fireEvent.scroll(list, { target: { scrollTop: 800 } });
    expect(mockDispatch).toHaveBeenCalledTimes(1);

    act(() => nextRequest.success({ rows: [{ id: 'last-model' }], total: 13, pageIndex: 2, pageSize: 12 }));
    expect(screen.getByTestId('model-cards').children).toHaveLength(13);
    expect(list.scrollTop).toBe(800);
    fireEvent.scroll(list);
    expect(mockDispatch).toHaveBeenCalledTimes(1);
  });

  it('returns the list to the top after filtering and resetting', async () => {
    const { container } = render(<ModelMgr />);
    await act(async () => {});
    const list = container.querySelector<HTMLElement>(`.${styles.cardList}`)!;
    const group = within(screen.getByRole('group', { name: 'modelMgr.filterModelType' }));
    const latestRequest = () => mockDispatch.mock.calls[mockDispatch.mock.calls.length - 1][0];

    list.scrollTop = 500;
    fireEvent.click(group.getAllByText('自定义类型').find((item) => !item.closest('[aria-hidden="true"]'))!);
    act(() => latestRequest().success({ rows: [{ id: 'filtered-model' }], total: 1, pageIndex: 1, pageSize: 12 }));
    expect(list.scrollTop).toBe(0);

    list.scrollTop = 300;
    fireEvent.click(screen.getByRole('button', { name: 'Reset' }));
    act(() => latestRequest().success({ rows: [], total: 0, pageIndex: 1, pageSize: 12 }));
    expect(list.scrollTop).toBe(0);
    expect(screen.getByText('modelMgr.emptyTitle')).toBeInTheDocument();
  });
});
