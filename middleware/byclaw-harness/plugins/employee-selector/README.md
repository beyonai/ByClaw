# 数字员工选择插件

通过 DSH 官方 agent-presets 扩展点向会话选择器注入已授权数字员工，无需修改 DSH 页面源码。点击新会话输入框上方的“标准模式”，选择员工，随后发送消息。会话绑定会持久化；恢复会话仍加载同一员工。子代理不继承根员工身份。模板 persona、Skills 和模型来自 ByClaw 同步结果，超级助手额外挂载授权目录与 Jev 路由提示。

依赖启用 @byclaw/dsh-integration。安装：`dsh plugin --profile byclaw-local add link:/absolute/path/plugins/employee-selector`。插件仅维护带自身标记的 `~/.dsh/.agent-presets/byclaw-employee-*` 目录，每五秒同步授权目录；执行前再次检查当前授权。退出进程后这些预设保留，插件卸载后可删除带标记的目录。
