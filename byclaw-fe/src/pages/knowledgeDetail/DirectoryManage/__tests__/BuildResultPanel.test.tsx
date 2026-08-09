import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { KnowledgeBuildResult } from '@/service/knowledgeCenter';
import BuildResultPanel from '../BuildResultPanel';

const mockMessageError = jest.fn();
const mockDownloadResourceFile = jest.fn();
const mockDownloadFile = jest.fn();
const mockGetKnowledgeBuildResult = jest.fn();

jest.mock('@umijs/max', () => ({
  useIntl: () => ({
    formatMessage: ({ id }: { id: string }) => id,
  }),
}));

jest.mock('antd', () => {
  const actual = jest.requireActual('antd');
  return {
    ...actual,
    App: {
      useApp: () => ({
        message: {
          error: mockMessageError,
          success: jest.fn(),
        },
      }),
    },
  };
});

jest.mock('@/components/Markdown', () => ({ text }: { text: string }) => <div>{text}</div>);

jest.mock('@/service/file', () => ({
  downloadResourceFile: (...args: unknown[]) => mockDownloadResourceFile(...args),
}));

jest.mock('@/service/knowledgeCenter', () => ({
  getKnowledgeBuildResult: (...args: unknown[]) => mockGetKnowledgeBuildResult(...args),
}));

jest.mock('@/utils/file', () => ({
  downloadFile: (...args: unknown[]) => mockDownloadFile(...args),
}));

const buildResult: KnowledgeBuildResult = {
  knCode: 'KN001',
  filePath: '/slides/demo.pptx',
  fileName: 'demo.pptx',
  fileType: 'pptx',
  fileSize: 1024,
  build: {
    status: 'complete',
    durationMs: 1200,
  },
  markdown: {
    available: true,
    data: '# Demo',
    lineCount: 1,
    characterCount: 6,
    byteCount: 6,
  },
  chunks: {
    data: [],
    page: 1,
    pageSize: 20,
    total: 0,
    reachedEof: true,
  },
  embedding: {
    dimension: 1024,
    embeddedChunkCount: 0,
    coverageRate: 0,
  },
  retrieval: {
    indexedChunkCount: 0,
    coverageRate: 0,
  },
};

describe('BuildResultPanel', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockGetKnowledgeBuildResult.mockResolvedValue(buildResult);
  });

  it('downloads the original source file from the action before Download Markdown', async () => {
    const sourceBlob = new Blob(['pptx']);
    mockDownloadResourceFile.mockResolvedValue({ file: sourceBlob, fileName: '' });

    render(
      <BuildResultPanel resourceId={10053191} filePath="/slides/demo.pptx" fileName="demo.pptx" onClose={jest.fn()} />
    );

    const sourceActions = await screen.findAllByText('buildResult.downloadSource');
    const markdownActions = screen.getAllByText('buildResult.downloadMarkdown');
    const sourceButton = sourceActions[0].closest('button');
    const markdownButton = markdownActions[0].closest('button');

    expect(sourceActions).toHaveLength(1);
    expect(markdownActions).toHaveLength(1);
    expect(sourceButton).not.toBeNull();
    expect(markdownButton).not.toBeNull();
    expect(sourceButton!.compareDocumentPosition(markdownButton!) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    fireEvent.click(sourceButton!);

    await waitFor(() => {
      expect(mockDownloadResourceFile).toHaveBeenCalledWith({
        resourceId: 10053191,
        directoryPath: '/slides/demo.pptx',
      });
      expect(mockDownloadFile).toHaveBeenCalledWith({
        file: sourceBlob,
        fileUrl: undefined,
        fileName: 'demo.pptx',
      });
    });
  });
});
