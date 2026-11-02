# groksearchcli

`groksearchcli` 为 ByClaw Skill 提供 Grok Web Search、X Search 和联合研究命令。

CLI 使用官方 `xai_sdk` 的 Chat API 和流式接口；业务 Skill 不需要直接导入 SDK。

安装：

```bash
python -m pip install .
```

查询本地机器合同：

```bash
groksearchcli describe --all
```

显示接近 xAI SDK 示例的推理和工具调用过程：

```bash
groksearchcli web search --query "查询本体的资源" --timeout 180s --verbose
```

过程信息写入 stderr，最终稳定 JSON 仍单独写入 stdout。

开发业务 Skill 前请阅读 [`AGENT_SKILL_DEVELOPMENT.md`](AGENT_SKILL_DEVELOPMENT.md)。架构和公开
协议见 [`DESIGN.md`](DESIGN.md)。
