import { render } from '@testing-library/react';
import FileTreeList from '../components/FileTreeList';

jest.mock('@umijs/max', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl };
});

const renderTree = (getNodeExtra?: (item: any) => any) =>
  render(
    <FileTreeList
      items={
        [
          { name: '0001-issue-237-project-navigation', path: '0001-issue-237-project-navigation', isDir: true },
          { name: 'docs', path: 'docs', isDir: true },
          { name: 'readme.md', path: 'readme.md' },
        ] as any
      }
      childrenByPath={{}}
      expandedKeys={[]}
      currentPath="/"
      loading={false}
      emptyText="empty"
      onExpand={() => undefined}
      onLoadData={async () => undefined}
      onNodeClick={() => undefined}
      onNodeDoubleClick={() => undefined}
      getActionItems={() => []}
      onAction={() => undefined}
      getNodeExtra={getNodeExtra}
    />
  );

describe('FileTreeList 行尾额外节点的预留空间', () => {
  it('getNodeExtra 返回节点时给标题容器挂上预留类，长名与短名一致', () => {
    const { container } = renderTree(() => <button type="button" aria-label="GitHub" />);

    const titles = container.querySelectorAll('.treeTitleContent');
    expect(titles).toHaveLength(3);
    for (const title of Array.from(titles)) {
      expect(title).toHaveClass('treeTitleContentWithExtra');
    }
    // 长名与短名两种输入都渲染出图标，且名称元素仍带省略能力所依赖的类。
    expect(container.querySelectorAll('[aria-label="GitHub"]')).toHaveLength(3);
    expect(container.querySelectorAll('.treeTitleName')).toHaveLength(3);
  });

  it('getNodeExtra 返回 null 时不挂预留类（非 Git 目录行、文件行无回归）', () => {
    const { container } = renderTree(() => null);

    const titles = container.querySelectorAll('.treeTitleContent');
    expect(titles).toHaveLength(3);
    for (const title of Array.from(titles)) {
      expect(title).not.toHaveClass('treeTitleContentWithExtra');
    }
  });

  it('未传 getNodeExtra 时不挂预留类', () => {
    const { container } = renderTree(undefined);

    expect(container.querySelectorAll('.treeTitleContentWithExtra')).toHaveLength(0);
  });
});
