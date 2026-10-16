import { fireEvent, render, screen } from '@testing-library/react';
import { App } from 'antd';
import { useRef, useState } from 'react';

import { uploadFiles } from '@/service/file';
import UploadFile, { UploadFileRef } from '..';

jest.mock('@/service/file', () => ({ uploadFiles: jest.fn() }));

jest.mock('@umijs/max', () => ({
  useIntl: () => ({ formatMessage: ({ id }: { id: string }) => id }),
}));

const mockUploadFiles = uploadFiles as jest.MockedFunction<typeof uploadFiles>;
const originalCreateObjectURL = URL.createObjectURL;

function UploadConsumer() {
  const uploadRef = useRef<UploadFileRef>(null);
  const [sessionId, setSessionId] = useState<string | number>('existing-session');
  const [sessionName, setSessionName] = useState('Existing session');
  const [sessionChanges, setSessionChanges] = useState(0);
  const [uploadStatus, setUploadStatus] = useState('idle');

  return (
    <App>
      <UploadFile
        ref={uploadRef}
        accept=".zip"
        onCreate={() => true}
        onUpdate={(file) => setUploadStatus(file.status)}
        onRemove={() => setUploadStatus('removed')}
        setSessionId={(nextSessionId, nextSessionName) => {
          setSessionId(nextSessionId);
          setSessionName(nextSessionName || '');
          setSessionChanges((changes) => changes + 1);
        }}
      >
        <span>Attachment picker</span>
      </UploadFile>
      <button
        type="button"
        onClick={() =>
          uploadRef.current?.uploadFile(new File(['materials'], 'materials.zip', { type: 'application/zip' }))
        }
      >
        Upload materials
      </button>
      <output aria-label="Current session">{`${typeof sessionId}:${sessionId}`}</output>
      <output aria-label="Session name">{sessionName}</output>
      <output aria-label="Session changes">{sessionChanges}</output>
      <output aria-label="Upload status">{uploadStatus}</output>
    </App>
  );
}

describe('UploadFile session identity boundary', () => {
  beforeAll(() => {
    URL.createObjectURL = () => 'blob:uploaded-materials';
  });

  afterAll(() => {
    URL.createObjectURL = originalCreateObjectURL;
  });

  beforeEach(() => {
    jest.clearAllMocks();
  });

  const uploadedFile = {
    fileId: 23,
    fileName: 'materials.zip',
    originFileName: 'materials.zip',
    fileUrl: '/files/materials.zip',
    fileType: 'zip',
    uploadState: 'SUCCESS',
  };

  it.each([11273602, '11273602'])(
    'reports sessionId=%p to the consumer as a string after uploading',
    async (sessionId) => {
      mockUploadFiles.mockResolvedValue({
        sessionId,
        sessionName: 'Uploaded materials',
        uploadItems: [uploadedFile],
        rebuildFileList: [uploadedFile],
      });
      render(<UploadConsumer />);

      fireEvent.click(screen.getByRole('button', { name: 'Upload materials' }));

      expect(await screen.findByText('done')).toBeInTheDocument();
      expect(screen.getByLabelText('Current session')).toHaveTextContent('string:11273602');
      expect(screen.getByLabelText('Session name')).toHaveTextContent('Uploaded materials');
      expect(screen.getByLabelText('Session changes')).toHaveTextContent('1');
    }
  );

  it.each([undefined, null, ''])('keeps the current session when upload returns sessionId=%p', async (sessionId) => {
    mockUploadFiles.mockResolvedValue({
      ...(sessionId === undefined ? {} : { sessionId }),
      sessionName: 'Uploaded materials',
      uploadItems: [uploadedFile],
      rebuildFileList: [uploadedFile],
    });
    render(<UploadConsumer />);

    fireEvent.click(screen.getByRole('button', { name: 'Upload materials' }));

    expect(await screen.findByText('done')).toBeInTheDocument();
    expect(screen.getByLabelText('Current session')).toHaveTextContent('string:existing-session');
    expect(screen.getByLabelText('Session name')).toHaveTextContent('Existing session');
    expect(screen.getByLabelText('Session changes')).toHaveTextContent('0');
  });
});
