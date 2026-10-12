# MainDrawer 层级约定

普通模式（`overlay: false`）在主页面布局内显示远程桌面或文件预览。内部 `.myDrawer` 不设置高于全局弹层的层级，调用链详情等 Ant Design Drawer 应完整覆盖它。关闭全局 Drawer 后，原有远程内容和交互状态继续保留。

覆盖模式（`overlay: true`）用于运营账号登录。外层 Ant Design Drawer 负责遮罩和层级，使用 `zIndex={1300}`，高于项目账号面板 `.detailPanelOverlay` 的 `1000`。账号登录所需的覆盖关系由外层 Drawer 保证，不依赖普通模式的内部样式。

`__tests__/layering.test.tsx` 实际编译 MainDrawer 和 PCLayout 的 Less，渲染真实 MainDrawer、事件订阅和 Ant Design Drawer，验证普通模式层级、关闭后的内容保留，以及账号登录覆盖模式。仅替换远程桌面、预览和移动页面等内容边界。

JSDOM 测试检查计算样式和组件状态；遮罩的视觉覆盖与鼠标命中需要另行使用浏览器验证。远程沙箱连接、平台扫码与登录状态保存属于后端集成验证范围。
