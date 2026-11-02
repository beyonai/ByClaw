import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { App } from 'antd';
import { createRef, useRef, useState } from 'react';
import { uploadFiles } from '@/service/file';
import type { IFile } from '@/typescript/file';
import UploadFile, { type UploadFileRef } from '..';

jest.mock('@/service/file', () => ({ uploadFiles: jest.fn() }));
jest.mock('@umijs/max', () => ({ useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }) }));

const requests: {
  data: FormData;
  progress?: (event: any) => void;
  resolve: (value: any) => void;
  reject: (reason: any) => void;
}[] = [];
const updates = jest.fn();
const sessionChanges = jest.fn();
const originalCreateObjectURL = URL.createObjectURL;

function Harness({
  sessionId = 'session-a',
  uploader,
  fileCount = 2,
}: {
  sessionId?: string;
  fileCount?: number;
  uploader?: (file: File, report: (event: any) => void) => Promise<any>;
}) {
  const ref = useRef<UploadFileRef>(null);
  const [files, setFiles] = useState<IFile[]>([]);
  return (
    <App>
      <UploadFile
        ref={ref}
        uploadFile={uploader}
        extendsPayload={{ sessionId }}
        onCreate={(file) => {
          setFiles((list) => [...list, file]);
          return true;
        }}
        onUpdate={(file) => {
          updates(file);
          setFiles((list) => list.map((item) => (item.uid === file.uid ? file : item)));
        }}
        onRemove={(file) => setFiles((list) => list.filter((item) => item.uid !== file.uid))}
        setSessionId={sessionChanges}
      >
        <span>choose</span>
      </UploadFile>
      <button
        onClick={() => {
          ref.current?.uploadFile(new File(['a'.repeat(100)], 'first.txt'));
          ref.current?.uploadFile(new File(['b'.repeat(100)], 'second.txt'));
          if (fileCount === 3) ref.current?.uploadFile(new File(['c'.repeat(100)], 'third.txt'));
        }}
      >
        upload two
      </button>
      {files.map((file) => (
        <div key={file.uid} data-testid={file.file?.name}>
          <span>{`${file.status}:${file.uploadProgress ?? 0}`}</span>
          {file.retryUpload && <button onClick={file.retryUpload}>retry {file.file?.name}</button>}
        </div>
      ))}
    </App>
  );
}

beforeAll(() => {
  URL.createObjectURL = () => 'blob:attachment';
});
afterAll(() => {
  URL.createObjectURL = originalCreateObjectURL;
});
beforeEach(() => {
  requests.length = 0;
  updates.mockClear();
  sessionChanges.mockClear();
  (uploadFiles as jest.Mock).mockClear();
  (uploadFiles as jest.Mock).mockImplementation(
    (data, progress) => new Promise((resolve, reject) => requests.push({ data, progress, resolve, reject }))
  );
});

const succeed = (index: number, name: string, sessionId?: string) =>
  requests[index].resolve({ sessionId, uploadItems: [{ fileId: index + 1, fileName: name }] });

test('interleaved per-file progress and completion update only the matching attachment', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('upload two'));
  expect(requests).toHaveLength(2);
  expect(requests[0].data.getAll('files')).toHaveLength(1);
  expect(requests[1].data.getAll('files')).toHaveLength(1);
  act(() => requests[0].progress?.({ loaded: 25, total: 100 }));
  expect(screen.getByTestId('first.txt')).toHaveTextContent('uploading:25');
  expect(screen.getByTestId('second.txt')).toHaveTextContent('uploading:0');
  act(() => requests[1].progress?.({ loaded: 70, total: 100 }));
  act(() => requests[0].progress?.({ loaded: 40, total: 100 }));
  expect(screen.getByTestId('first.txt')).toHaveTextContent('uploading:40');
  expect(screen.getByTestId('second.txt')).toHaveTextContent('uploading:70');
  await act(async () => succeed(1, 'second.txt'));
  expect(screen.getByTestId('first.txt')).toHaveTextContent('uploading:40');
  expect(screen.getByTestId('second.txt')).toHaveTextContent('done:100');
  await act(async () => succeed(0, 'first.txt'));
});

test('one failure remains retryable without resetting a successful sibling or reusing its progress', async () => {
  render(<Harness />);
  fireEvent.click(screen.getByText('upload two'));
  await act(async () => {
    requests[0].reject(new Error('connection lost'));
    succeed(1, 'second.txt');
  });
  expect(screen.getByTestId('first.txt')).toHaveTextContent('error:0');
  expect(screen.getByTestId('second.txt')).toHaveTextContent('done:100');
  fireEvent.click(screen.getByRole('button', { name: 'retry first.txt' }));
  expect(requests).toHaveLength(3);
  act(() => requests[2].progress?.({ loaded: 60, total: 100 }));
  act(() => requests[0].progress?.({ loaded: 99, total: 100 }));
  expect(screen.getByTestId('first.txt')).toHaveTextContent('uploading:60');
  expect(screen.getByTestId('second.txt')).toHaveTextContent('done:100');
  await act(async () => succeed(2, 'first.txt'));
  expect(screen.getByTestId('first.txt')).toHaveTextContent('done:100');
});

test('an earlier chat cannot publish progress, failures or session changes after switching chats', async () => {
  const { rerender } = render(<Harness />);
  fireEvent.click(screen.getByText('upload two'));
  rerender(<Harness sessionId="session-b" />);
  updates.mockClear();
  await act(async () => {
    requests[0].progress?.({ loaded: 50, total: 100 });
    succeed(0, 'first.txt', 'session-a');
    requests[1].reject(new Error('old chat error'));
  });
  expect(updates).not.toHaveBeenCalled();
  expect(sessionChanges).not.toHaveBeenCalled();
  expect(screen.queryByText('old chat error')).not.toBeInTheDocument();
});

test('new-chat file uploads establish one session before uploading siblings with its identity', async () => {
  render(<Harness sessionId="" />);
  fireEvent.click(screen.getByText('upload two'));
  expect(requests).toHaveLength(1);
  await act(async () => succeed(0, 'first.txt', 'created-session'));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].data.get('sessionId')).toBe('created-session');
  await act(async () => succeed(1, 'second.txt', 'created-session'));
  expect(sessionChanges).toHaveBeenCalledTimes(1);
  expect(sessionChanges).toHaveBeenCalledWith('created-session', undefined);
});

test('the OpenClaw transport shares per-attachment progress without calling the chat upload endpoint', async () => {
  const custom: { file: File; report: (event: any) => void; resolve: (value: any) => void }[] = [];
  const uploader = (file: File, report: (event: any) => void) =>
    new Promise((resolve) => custom.push({ file, report, resolve }));
  render(<Harness uploader={uploader} />);
  fireEvent.click(screen.getByText('upload two'));
  expect(custom).toHaveLength(2);
  expect(uploadFiles).not.toHaveBeenCalled();
  act(() => {
    custom[0].report({ loaded: 10, total: 100 });
    custom[1].report({ loaded: 80, total: 100 });
  });
  expect(screen.getByTestId('first.txt')).toHaveTextContent('uploading:10');
  expect(screen.getByTestId('second.txt')).toHaveTextContent('uploading:80');
  await act(async () =>
    custom.forEach((request) =>
      request.resolve({
        queryFile: { fileId: 0, fileName: request.file.name, fileUrl: 'uploads/' + request.file.name },
        downloadUrl: 'https://gateway.example/download/' + request.file.name,
      })
    )
  );
  expect(updates).toHaveBeenCalledWith(
    expect.objectContaining({ status: 'done', downloadUrl: 'https://gateway.example/download/first.txt' })
  );
});

test('hiding a full attachment picker keeps existing transfer callbacks and retries alive', async () => {
  let created: IFile | undefined;
  const ref = createRef<UploadFileRef>();
  const props = {
    ref,
    onCreate: (file: IFile) => {
      created = file;
      return true;
    },
    onUpdate: updates,
    onRemove: jest.fn(),
    setSessionId: sessionChanges,
    extendsPayload: { sessionId: 'session-a' },
  };
  const { rerender } = render(
    <App>
      <UploadFile {...props}>
        <span>attachment picker</span>
      </UploadFile>
    </App>
  );
  act(() => ref.current?.uploadFile(new File(['content'], 'only.txt')));
  rerender(
    <App>
      <UploadFile {...props} hidden>
        <span>attachment picker</span>
      </UploadFile>
    </App>
  );
  expect(screen.getByText('attachment picker')).not.toBeVisible();
  act(() => requests[0].progress?.({ loaded: 60, total: 100 }));
  expect(updates).toHaveBeenCalledWith(
    expect.objectContaining({ uid: created?.uid, status: 'uploading', uploadProgress: 60 })
  );
  await act(async () => succeed(0, 'only.txt'));
  expect(updates).toHaveBeenCalledWith(
    expect.objectContaining({ uid: created?.uid, status: 'done', uploadProgress: 100 })
  );
});

test('switching chats keeps an already selected new-chat batch bound to its original created session', async () => {
  const { rerender } = render(<Harness sessionId="" />);
  fireEvent.click(screen.getByText('upload two'));
  expect(requests).toHaveLength(1);
  rerender(<Harness sessionId="other-chat" />);
  updates.mockClear();
  await act(async () => succeed(0, 'first.txt', 'original-created-chat'));
  await waitFor(() => expect(requests).toHaveLength(2));
  expect(requests[1].data.get('sessionId')).toBe('original-created-chat');
  await act(async () => succeed(1, 'second.txt', 'original-created-chat'));
  expect(updates).not.toHaveBeenCalled();
  expect(sessionChanges).not.toHaveBeenCalled();
});

test('failed first new-chat creation still serializes multiple waiting siblings', async () => {
  render(<Harness sessionId="" fileCount={3} />);
  fireEvent.click(screen.getByText('upload two'));
  expect(requests).toHaveLength(1);
  await act(async () => requests[0].reject(new Error('initial session request failed')));
  await waitFor(() => expect(requests).toHaveLength(2));
  await act(async () => succeed(1, 'second.txt', 'recovered-session'));
  await waitFor(() => expect(requests).toHaveLength(3));
  expect(requests[2].data.get('sessionId')).toBe('recovered-session');
  await act(async () => succeed(2, 'third.txt', 'recovered-session'));
  expect(sessionChanges).toHaveBeenCalledTimes(1);
  expect(sessionChanges).toHaveBeenCalledWith('recovered-session', undefined);
});
