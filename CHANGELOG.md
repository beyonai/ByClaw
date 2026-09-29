# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

### Changed

- 停用本体库、对象、视图、场景四类资源能力（GitHub #267）：列表与详情入口不再返回这些类型，运行时查询在条目级给出统一停用原因，插件对话路径在 MCP 发现之前短路，托管提示文件与工具描述不再注入相关指引。停用范围、响应行为、部署复验步骤、回退风险与未覆盖清单见 [`docs/disabled-resource-capabilities.md`](docs/disabled-resource-capabilities.md)。
- 内置技能 `crm-demo-showcase` 清理对象/视图旧调用指引，并在文档中补充下线说明。

### Added

- Repository-wide layout, GitHub templates, and agent harness files (`AGENTS.md`, `CLAUDE.md`) aligned with open-source practice notes.
