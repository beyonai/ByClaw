/**
 * 用于保留antd弹窗原本的动画效果，但是关闭弹窗后，销毁组件。
 * 如果组件内部状态非常复杂，很难完全根据props来控制内部数据的改变，用这个组件，可以使得组件逻辑变得更简单，只要考虑初始状态就可以了

 * 这里不直接使用Modal，因为大部分情况下，弹窗的ok按钮还是需要自己来实现，分割组件的话不好维护
 * 至于组件名字，可能以后还会做popover等等所有需要动画效果的组件，到时候补充afterOpenChange参数就好了
 */

import React, { useCallback, useEffect, useState } from 'react';

export default function NullableAntdCompWithAnim<T = any>(props: { children: React.ReactElement<T>; open: boolean }) {
  const { children, open } = props;
  const [visible, setVisible] = useState(open);

  useEffect(() => {
    if (open) {
      setVisible(true);
    }
  }, [open]);

  const afterClose = useCallback(() => {
    setVisible(false);
  }, []);

  if (!visible) return null;

  return React.createElement(children.type, {
    ...(children.props || {}),
    afterClose,
    afterOpenChange: setVisible,
  });
}
