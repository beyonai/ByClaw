import { render } from '@testing-library/react';
import FileTreeList from '../components/FileTreeList';

jest.mock('@umijs/max', () => {
  const intl = { formatMessage: ({ id }: { id: string }) => id };
  return { useIntl: () => intl };
});

const items = [
  { name: '0001-issue-237-project-navigation', path: '0001-issue-237-project-navigation', isDir: true },
  { name: 'docs', path: 'docs', isDir: true },
  { name: 'readme.md', path: 'readme.md', isDir: false },
];

interface RenderTreeOptions {
  getNodeExtra?: (item: any) => any;
  getActionItems?: (item: any) => any;
}

const renderTree = ({ getNodeExtra, getActionItems }: RenderTreeOptions = {}) =>
  render(
    <FileTreeList
      items={items as any}
      childrenByPath={{}}
      expandedKeys={[]}
      currentPath="/"
      loading={false}
      emptyText="empty"
      onExpand={() => undefined}
      onLoadData={async () => undefined}
      onNodeClick={() => undefined}
      onNodeDoubleClick={() => undefined}
      getActionItems={getActionItems || (() => [])}
      onAction={() => undefined}
      getNodeExtra={getNodeExtra}
    />
  );

const githubExtra = () => <button type="button" aria-label="GitHub" />;

describe('FileTreeList 行尾附加节点的槽位预留', () => {
  it('附加节点以固定槽位渲染在目录名之后，并给标题容器挂上预留类', () => {
    const { container } = renderTree({ getNodeExtra: githubExtra });

    const titles = Array.from(container.querySelectorAll('.treeTitleContent'));
    expect(titles).toHaveLength(items.length);
    for (const title of titles) {
      expect(title).toHaveClass('treeTitleContentWithExtra');
    }

    // 每行的附加节点都排在名称元素之后，不再与目录名争抢同一段横向空间。
    const names = container.querySelectorAll('.treeTitleName');
    expect(names).toHaveLength(items.length);
    for (const name of Array.from(names)) {
      expect(name.nextElementSibling).toHaveAttribute('aria-label', 'GitHub');
    }
    expect(container.querySelectorAll('[aria-label="GitHub"]')).toHaveLength(items.length);
  });

  it('逐行判定：只有返回附加节点的行才挂预留类，同一次求值的结果同时用于渲染', () => {
    const { container } = renderTree({
      getNodeExtra: (item) => (item.path === 'docs' ? githubExtra() : null),
    });

    const titles = Array.from(container.querySelectorAll('.treeTitleContent'));
    expect(titles).toHaveLength(items.length);
    const reserved = titles.filter((title) => title.classList.contains('treeTitleContentWithExtra'));
    expect(reserved).toHaveLength(1);
    expect(reserved[0].querySelector('.treeTitleText')).toHaveTextContent('docs');

    const extras = container.querySelectorAll('[aria-label="GitHub"]');
    expect(extras).toHaveLength(1);
    expect(reserved[0].contains(extras[0])).toBe(true);
  });

  it('附加节点为 null 或未传 getNodeExtra 时不挂预留类（非 Git 行无回归）', () => {
    const nullExtra = renderTree({ getNodeExtra: () => null });
    expect(nullExtra.container.querySelectorAll('.treeTitleContentWithExtra')).toHaveLength(0);
    expect(nullExtra.container.querySelectorAll('.treeTitleContent')).toHaveLength(items.length);
    nullExtra.unmount();

    const noExtra = renderTree();
    expect(noExtra.container.querySelectorAll('.treeTitleContentWithExtra')).toHaveLength(0);
  });

  it('只有附加节点与三点操作按钮同时存在时才预留行尾按钮槽位', () => {
    const actionItems = [{ key: 'rename', label: 'rename' }];

    const both = renderTree({ getNodeExtra: githubExtra, getActionItems: () => actionItems });
    const bothTitles = Array.from(both.container.querySelectorAll('.treeTitleContent'));
    expect(bothTitles).toHaveLength(items.length);
    for (const title of bothTitles) {
      expect(title).toHaveClass('treeTitleContentActionSlot');
    }
    expect(both.container.querySelectorAll('.treeActionTrigger')).toHaveLength(items.length);
    both.unmount();

    // 没有附加节点时沿用原有的 hover 预留方式，避免普通文件行被额外压缩。
    const onlyActions = renderTree({ getActionItems: () => actionItems });
    expect(onlyActions.container.querySelectorAll('.treeTitleContentActionSlot')).toHaveLength(0);
    expect(onlyActions.container.querySelectorAll('.treeActionTrigger')).toHaveLength(items.length);
  });

  it('showActions 关闭时不渲染三点按钮，也不预留按钮槽位', () => {
    const { container } = render(
      <FileTreeList
        items={items as any}
        childrenByPath={{}}
        expandedKeys={[]}
        currentPath="/"
        loading={false}
        emptyText="empty"
        showActions={false}
        onExpand={() => undefined}
        onLoadData={async () => undefined}
        onNodeClick={() => undefined}
        onNodeDoubleClick={() => undefined}
        getActionItems={() => [{ key: 'rename', label: 'rename' }]}
        onAction={() => undefined}
        getNodeExtra={githubExtra}
      />
    );

    expect(container.querySelectorAll('.treeActionTrigger')).toHaveLength(0);
    expect(container.querySelectorAll('.treeTitleContentActionSlot')).toHaveLength(0);
    expect(container.querySelectorAll('.treeTitleContentWithExtra')).toHaveLength(items.length);
  });
});
