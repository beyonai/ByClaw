# 编辑器 DOM 生命周期

打开预览或切换懒加载内容时，外层 Suspense 可能暂时隐藏已聚焦的输入框。
Slate 0.117 在 ref 解绑时删除编辑器的 DOM 映射，而保留的 DOM 随后仍可能产生 blur。
此时直接进入 Slate 的失焦处理会抛出 `Cannot resolve a DOM node from Slate node`。

`EditableRootWithAria` 跟踪根 ref，在解绑后的 blur 中仅清除 Slate 的聚焦标记，
不查询 DOM、不清空草稿或选区；正常挂载时仍调用 Slate 原有处理器，事件继续向外冒泡。
恢复显示后沿用同一编辑器和草稿。升级 Slate 时需重新检查这项兼容处理。

回归：`pnpm exec jest src/components/QueryInput/RichInput --runInBand`。
生命周期用例使用真实 React、Slate 和 Suspense，覆盖隐藏时预览取得焦点、恢复输入、
正常重渲染及失焦。
