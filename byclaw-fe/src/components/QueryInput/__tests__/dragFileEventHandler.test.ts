import { message } from 'antd';
import DragFileEventHandler from '../dragFileEventHandler';

jest.mock('@umijs/max', () => ({
  getIntl: () => ({ formatMessage: ({ id }: { id: string }, values: { size: number }) => `${id}:${values.size}` }),
}));

describe('chat attachment drag size validation', () => {
  let container: HTMLDivElement;
  let handler: DragFileEventHandler;
  const onDropFile = jest.fn();

  beforeEach(() => {
    jest.clearAllMocks();
    jest.spyOn(message, 'error').mockImplementation(jest.fn());
    container = document.createElement('div');
    handler = new DragFileEventHandler(container, {
      onDropFile,
      uploadFileConfig: () => ({ enabled: true, allowedFileTypes: [], maxFileSize: 10, maxFileCount: 0 }),
    });
  });

  afterEach(() => {
    handler.destroy();
    jest.restoreAllMocks();
  });

  function drop(sizes: number[]) {
    const files = sizes.map((size, index) => {
      const file = new File(['content'], `file-${index}.pdf`);
      Object.defineProperty(file, 'size', { value: size });
      return file;
    });
    const event = new Event('drop', { cancelable: true });
    Object.defineProperty(event, 'dataTransfer', { value: { files } });
    container.dispatchEvent(event);
    return files;
  }

  it('blocks oversized dropped files and shows the configured limit', () => {
    drop([21196721]);

    expect(onDropFile).not.toHaveBeenCalled();
    expect(message.error).toHaveBeenCalledTimes(1);
    expect(message.error).toHaveBeenCalledWith('upload.fileSizeLimit:10');
  });

  it('filters oversized files while retaining files exactly at the configured limit', () => {
    const files = drop([10 * 1024 * 1024, 21196721]);

    expect(onDropFile).toHaveBeenCalledWith([files[0]]);
    expect(message.error).toHaveBeenCalledTimes(1);
  });
});
