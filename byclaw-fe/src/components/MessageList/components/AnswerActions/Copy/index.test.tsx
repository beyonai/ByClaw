import { fireEvent, render, screen, act } from '@testing-library/react';
import copy from 'copy-to-clipboard';
import Copy from './index';

jest.mock('copy-to-clipboard', () => ({ __esModule: true, default: jest.fn(() => true) }));
jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));
jest.mock('@/components/AntdIcon', () => () => null);
jest.mock('@/components/Markdown/katex/showdown-katex', () => () => []);
jest.mock('@/components/Markdown/showdown', () => ({
  Converter: jest.fn(() => ({ makeHtml: (text: string) => `<p>${text}</p>` })),
}));
jest.mock('@/components/Markdown/utils', () => ({
  fixUnclosedCodeBlock: (text: string) => text,
  replaceMdString: (text: string) => text,
  replaceFilePrefixInMarkdown: (text: string) => text,
}));
jest.mock('@/utils/file', () => ({ getFileUrl: (path: string) => path }));

describe('message copy button', () => {
  beforeEach(() => {
    jest.useFakeTimers();
    jest.clearAllMocks();
  });

  afterEach(() => {
    jest.clearAllTimers();
    jest.useRealTimers();
  });

  const clickCopy = () => {
    fireEvent.click(screen.getByRole('button'));
    act(() => {
      jest.advanceTimersByTime(300);
    });
  };

  it('copies only question text without HTML or restorable resource payloads', () => {
    render(<Copy text="@数字员工 你好 #引用文件" richText="{{DIG_EMPLOYEE_102}} 你好 {{COMMON_FILE_1}}" />);
    clickCopy();
    expect(copy).toHaveBeenCalledWith('你好', { format: 'text/plain' });
  });

  it('preserves question markdown and line breaks as plain text', () => {
    render(<Copy text="**正文**\n第二行" richText={'**正文**\n第二行'} />);
    clickCopy();
    expect(copy).toHaveBeenCalledWith('**正文**\n第二行', { format: 'text/plain' });
  });

  it('does not offer copy when the question only contains mentions or references', () => {
    render(<Copy text="@数字员工 #引用文件" richText="{{DIG_EMPLOYEE_102}} {{COMMON_FILE_1}}" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    expect(copy).not.toHaveBeenCalled();
  });

  it('preserves answer HTML and plain text clipboard formats', () => {
    render(<Copy text="回答正文" showText />);
    clickCopy();
    const options = (copy as jest.Mock).mock.calls[0][1];
    const clipboard = { setData: jest.fn() };
    options.onCopy(clipboard);
    expect(clipboard.setData).toHaveBeenCalledWith('text/plain', '回答正文');
    expect(clipboard.setData).toHaveBeenCalledWith('text/html', expect.stringContaining('回答正文'));
    expect(clipboard.setData).not.toHaveBeenCalledWith('application/x-byai-slate', expect.anything());
  });
});
