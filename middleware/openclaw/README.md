# OpenClaw 镜像

`.env.example` 默认使用 `latest`，与数据库沙箱规格一致。更新时需重新拉取镜像并重建沙箱。

镜像不再安装、初始化或附带 gbrain 技能。升级需执行 V0.5.0 迁移，清理数据库中的 gbrain MCP、环境变量和内置技能配置；已有用户目录中的 gbrain 数据不删除。
