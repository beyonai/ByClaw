jest.mock('antd', () => ({
  Modal: (props: any) => ({ type: 'Modal', props }),
  Typography: {
    Paragraph: ({ children, ...props }: any) => ({ type: 'Paragraph', props: { ...props, children } }),
  },
}));

jest.mock('@/components/MobileComponents/BottomDrawer', () => ({
  __esModule: true,
  default: (props: any) => ({ type: 'BottomDrawer', props }),
}));

jest.mock('../useGlobal', () => ({
  __esModule: true,
  default: jest.fn(),
}));

import { renderHook, act } from '@testing-library/react';
import useGlobal from '../useGlobal';
import useModal from '../useModal';
import { Modal } from 'antd';
import BottomDrawer from '@/components/MobileComponents/BottomDrawer';

const mockUseGlobal = useGlobal as jest.MockedFunction<typeof useGlobal>;

describe('hooks/useModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders an antd Modal node on pc and handles ok/cancel', () => {
    const onOk = jest.fn();
    mockUseGlobal.mockReturnValue({ platform: 'pc' } as any);

    const { result } = renderHook(() =>
      useModal({
        title: 'Title',
        content: 'Content',
        onOk,
        footer: 'Footer',
      })
    );

    act(() => {
      result.current.setOpen(true);
      result.current.setMyTitle('New Title');
      result.current.setMyContent('New Content');
    });

    const node: any = result.current.ModalNode;
    expect(node.type).toBe(Modal);
    expect(node.props.open).toBe(true);
    expect(node.props.footer).toBe('Footer');

    act(() => {
      node.props.onOk();
    });

    expect(onOk).toHaveBeenCalled();
    expect(result.current.open).toBe(false);
  });

  it('renders BottomDrawer on mobile', () => {
    mockUseGlobal.mockReturnValue({ platform: 'mobile' } as any);

    const { result } = renderHook(() =>
      useModal({
        title: 'Title',
        content: 'Content',
        footer: 'Footer',
      })
    );

    act(() => {
      result.current.setOpen(true);
    });

    const node: any = result.current.ModalNode;
    expect(node.type).toBe(BottomDrawer);
    expect(node.props.open).toBe(true);
    expect(node.props.renderButtons).toBe('Footer');
  });
});
