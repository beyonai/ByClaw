# WeCom CLI 技能来源

业务技能和引用以实际发布的 `@wecom/cli@1.3.4` 对应提交
[f9b28151dc8d42f703db624fc9b26723c3c93fc5](https://github.com/WeComTeam/wecom-cli/tree/f9b28151dc8d42f703db624fc9b26723c3c93fc5/skills)
为基线，许可见 [LICENSE.upstream](LICENSE.upstream)。
不要以同样声明 1.3.4 的上游 main 代替该发布提交；main 含未发布的 sheet workbook/cells API。

本地保留 `wecomcli-msg` / `wecomcli-schedule` 目录名，分别对应上游 message / calendar 技能。
只同步现有业务域及 shared、doc-manage、media 依赖；没有启用独立邮件、微盘、幻灯片技能。
ByClaw 父级契约覆盖授权、租户隔离、平台同步及用户授权边界；不引入上游自动升级 latest、
默认禁止展示用户主动索取的非凭据 ID，或禁止经授权的只读知识采集的产品限制。
