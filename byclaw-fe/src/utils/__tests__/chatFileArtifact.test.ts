import {
  extractChatFileArtifactPaths,
  getChatFileArtifactPath,
  getRelativeChatFileArtifactPath,
  isRelativeChatFileArtifactPath,
  normalizeChatFileArtifactPath,
  isManagedChatFileArtifactPath,
} from '../chatFileArtifact';

describe('extractChatFileArtifactPaths', () => {
  it('extracts labelled, markdown, inline-code and bare paths', () => {
    const content = [
      '文件路径：/by/.sessions/101/output/团队周报.pptx',
      '[下载说明](</by/.sessions/101/output/使用说明.pdf>)',
      '备用文件：`/.sessions/101/output/data.xlsx`',
      '生成完成 /by/.openclaw/workspace-baiying-agent-8/output/result.docx',
    ].join('\n');

    expect(extractChatFileArtifactPaths(content)).toEqual([
      '/.sessions/101/output/团队周报.pptx',
      '/.sessions/101/output/使用说明.pdf',
      '/.sessions/101/output/data.xlsx',
      '/.openclaw/workspace-baiying-agent-8/output/result.docx',
    ]);
  });

  it('supports spaces when the path is labelled', () => {
    expect(extractChatFileArtifactPaths('保存到：/by/.sessions/101/output/Team Weekly Report.pptx')).toEqual([
      '/.sessions/101/output/Team Weekly Report.pptx',
    ]);
  });

  it('accepts an explicitly labelled absolute path outside known roots', () => {
    expect(extractChatFileArtifactPaths('输出文件：/tmp/generated/final-report.pdf')).toEqual([
      '/tmp/generated/final-report.pdf',
    ]);
  });

  it('ignores web urls, directories and unrelated absolute paths', () => {
    const content = [
      '接口：https://example.com/files/report.pdf',
      '目录：/by/.sessions/101/output/',
      '系统文件：/etc/passwd',
    ].join('\n');

    expect(extractChatFileArtifactPaths(content)).toEqual([]);
  });

  it('deduplicates paths', () => {
    const path = '/by/.sessions/101/output/a.txt';
    expect(extractChatFileArtifactPaths(`文件路径：${path}\n再次：\`${path}\``)).toEqual([
      '/.sessions/101/output/a.txt',
    ]);
  });

  it.each([
    '/by/.sessions/101/output/报告.html',
    '/.sessions/101/output/报告.html',
    'file:///by/.sessions/101/output/报告.html',
    '{{file_preview_prefix}}/by/.sessions/101/output/报告.html',
    '%7B%7Bfile_preview_prefix%7D%7D/by/.sessions/101/output/报告.html',
    '/byaiService/commonFile/preview?filePath=%2Fby%2F.sessions%2F101%2Foutput%2F%E6%8A%A5%E5%91%8A.html',
    '/commonFile/view?filePath=%2F.sessions%2F101%2Foutput%2F%E6%8A%A5%E5%91%8A.html',
    '/byaiService/chat/file-artifacts/download?sessionId=101&path=%2F.sessions%2F101%2Foutput%2F%E6%8A%A5%E5%91%8A.html',
  ])('normalizes local file representations: %s', (value) => {
    expect(getChatFileArtifactPath(value)).toBe('/.sessions/101/output/报告.html');
    expect(isManagedChatFileArtifactPath(value)).toBe(true);
  });

  it('normalizes same-origin absolute preview URLs without treating remote files as local artifacts', () => {
    const route = '/byaiService/commonFile/preview?filePath=%2Fby%2F.sessions%2F101%2Freport.html';
    expect(getChatFileArtifactPath(`${window.location.origin}${route}`)).toBe('/.sessions/101/report.html');
    expect(getChatFileArtifactPath(`https://example.com${route}`)).toBeUndefined();
    expect(getChatFileArtifactPath(`${route}&bucketName=other-user`)).toBeUndefined();
    expect(extractChatFileArtifactPaths(`[其他存储桶](${route}&bucketName=other-user)`)).toEqual([]);
    expect(isManagedChatFileArtifactPath('/files/report.html')).toBe(false);
    expect(extractChatFileArtifactPaths(`[外部报告](https://example.com${route})`)).toEqual([]);
    expect(extractChatFileArtifactPaths('外部报告：https://example.com/by/.sessions/101/report.html')).toEqual([]);
  });

  it('resolves a repeated placeholder, raw path and preview URL only once', () => {
    const path = '/.sessions/101/output/report.html';
    const content = [
      `[下载]({{file_preview_prefix}}/by${path})`,
      `[预览](/byaiService/commonFile/preview?filePath=${encodeURIComponent(path)})`,
      `文件路径：/by${path}`,
      `[再次下载](${path})`,
    ].join('\n');
    expect(extractChatFileArtifactPaths(content)).toEqual([path]);
  });
});

describe('current session artifact normalization', () => {
  it('uses the virtual session path for executor output without depending on its storage root', () => {
    expect(
      normalizeChatFileArtifactPath('/tmp/test/storage/byclaw-user/by/.sessions/101/image/result.jpg', '101')
    ).toBe('/by/.sessions/101/image/result.jpg');
    expect(normalizeChatFileArtifactPath('/mnt/shared/users/user/by/.sessions/101/tts/summary.mp3', '101')).toBe(
      '/by/.sessions/101/tts/summary.mp3'
    );
  });
  it('preserves paths outside the current session for backend authorization', () => {
    expect(normalizeChatFileArtifactPath('/tmp/output/file.pdf', '101')).toBe('/tmp/output/file.pdf');
    expect(normalizeChatFileArtifactPath('/tmp/by/.sessions/102/image/result.jpg', '101')).toBe(
      '/tmp/by/.sessions/102/image/result.jpg'
    );
    expect(normalizeChatFileArtifactPath('/by/.sessions/101/tts/summary.mp3', '101')).toBe(
      '/by/.sessions/101/tts/summary.mp3'
    );
  });
});

describe('relative session file links', () => {
  it.each([
    ['故地重游-高考作文.txt', '故地重游-高考作文.txt'],
    ['./motion-15s.html', 'motion-15s.html'],
    ['output/报告.txt#section', 'output/报告.txt'],
    ['output/Team%20Report.pdf?v=1', 'output/Team Report.pdf'],
  ])('resolves %s inside the current session', (href, relativePath) => {
    expect(isRelativeChatFileArtifactPath(href)).toBe(true);
    expect(getRelativeChatFileArtifactPath(href, '9007199254740993')).toBe(
      `/.sessions/9007199254740993/${relativePath}`
    );
  });

  it.each([
    '../private.txt',
    './output/../../private.txt',
    '%2e%2e/report.txt',
    'output/%2e%2e/report.txt',
    '%2Fetc/private.txt',
    'output/%00report.txt',
    'https://example.com/report.txt',
    '//example.com/report.txt',
    '/byaiService/commonFile/preview?filePath=report.txt',
  ])('rejects escaping paths and URLs: %s', (href) => {
    expect(getRelativeChatFileArtifactPath(href, '101')).toBeUndefined();
  });

  it('does not invent a session when context is unavailable', () => {
    expect(getRelativeChatFileArtifactPath('report.txt')).toBeUndefined();
    expect(getRelativeChatFileArtifactPath('report.txt', '../102')).toBeUndefined();
  });
});
