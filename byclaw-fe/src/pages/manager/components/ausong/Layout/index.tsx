import React from 'react';
import Flex from '@/pages/manager/components/ausong/Flex';
import Size from '@/pages/manager/components/ausong/Size';

function renderLayoutComponent(c: React.ReactNode, flexTag = 'none', key: string) {
  if (!c) {
    return null;
  }

  if (typeof c === 'string' || typeof c === 'number') {
    return <span>{c}</span>;
  }

  // 是否element元素
  const isReactElement = React.isValidElement(c);
  const isFunction = typeof c === 'function';

  if (!(isReactElement || isFunction)) {
    return null;
  }

  return (
    <Flex attrs={[flexTag]} key={key}>
      {isReactElement ? c : <Size>{(w: number, h: number) => c(w, h)}</Size>}
    </Flex>
  );
}

function Layout(props: any) {
  const { header, footer, left, right, children, className, style } = props;
  let { direction = 'column' } = props;

  const showHeader = !!header;
  const showFooter = !!footer;
  // 标识是否含有垂直方向组件
  const hasVerticalComponent = showHeader || showFooter;

  const showLeft = !!left;
  const showRight = !!right;
  // 标识是否含有水平方向组件
  const hasHorizontalComponent = showLeft || showRight;

  if (hasHorizontalComponent && !hasVerticalComponent) {
    direction = 'row';
  }

  if (hasVerticalComponent && !hasHorizontalComponent) {
    direction = 'column';
  }

  let c1;
  let c2;
  let c3;
  let c4;
  if (direction === 'column') {
    c1 = header;
    c2 = footer;
    c3 = left;
    c4 = right;
  } else {
    c1 = left;
    c2 = right;
    c3 = header;
    c4 = footer;
  }

  const hasTwoLevel = c3 || c4;
  const innerDirection = direction === 'column' ? 'row' : 'column';

  return (
    <Flex attrs={[direction]} className={className} style={style}>
      {renderLayoutComponent(c1, 'none', 'c1')}

      {hasTwoLevel ? (
        <Flex attrs={['auto', innerDirection]}>
          {renderLayoutComponent(c3, 'none', 'c3')}
          {renderLayoutComponent(children, 'auto', 'auto')}
          {renderLayoutComponent(c4, 'none', 'c4')}
        </Flex>
      ) : (
        renderLayoutComponent(children, 'auto', 'auto')
      )}
      {renderLayoutComponent(c2, 'none', 'c2')}
    </Flex>
  );
}

export default Layout;
