import { useEffect, useState } from 'react';
import { Pagination } from 'antd';

const CHARACTERS_PER_PAGE = 64_000;

/** 大文件的源码每次只挂载一段纯文本，避免整份内容进入高亮器和 DOM。 */
export default function PagedPreviewSource({ content }: { content: string }) {
  const [page, setPage] = useState(1);
  const totalPages = Math.max(1, Math.ceil(content.length / CHARACTERS_PER_PAGE));
  const currentPage = Math.min(page, totalPages);
  const start = (currentPage - 1) * CHARACTERS_PER_PAGE;

  useEffect(() => setPage(1), [content]);

  return (
    <>
      <Pagination
        current={currentPage}
        total={totalPages}
        pageSize={1}
        showSizeChanger={false}
        onChange={setPage}
        size="small"
      />
      <pre style={{ whiteSpace: 'pre-wrap', overflowWrap: 'anywhere' }}>
        {content.slice(start, start + CHARACTERS_PER_PAGE)}
      </pre>
    </>
  );
}
