import { extractChatFileArtifactPaths } from '../chatFileArtifact';

describe('extractChatFileArtifactPaths', () => {
  it('extracts labelled, markdown, inline-code and bare paths', () => {
    const content = [
      '文件路径：/by/.sessions/101/output/团队周报.pptx',
      '[下载说明](</by/.sessions/101/output/使用说明.pdf>)',
      '备用文件：`/.sessions/101/output/data.xlsx`',
      '生成完成 /by/.openclaw/workspace-baiying-agent-8/output/result.docx',
    ].join('\n');

    expect(extractChatFileArtifactPaths(content)).toEqual([
      '/by/.sessions/101/output/团队周报.pptx',
      '/by/.sessions/101/output/使用说明.pdf',
      '/.sessions/101/output/data.xlsx',
      '/by/.openclaw/workspace-baiying-agent-8/output/result.docx',
    ]);
  });

  it('supports spaces when the path is labelled', () => {
    expect(extractChatFileArtifactPaths('保存到：/by/.sessions/101/output/Team Weekly Report.pptx')).toEqual([
      '/by/.sessions/101/output/Team Weekly Report.pptx',
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
    expect(extractChatFileArtifactPaths(`文件路径：${path}\n再次：\`${path}\``)).toEqual([path]);
  });
});
