# Agent Note:显式区分 npm 发布通道

Status: implemented

[English](2026-09-01-npm-release-channels.md) | 中文

## Problem

仓库会从任意 `v*` tag 发布,而 `pnpm publish` 默认写入 `latest` dist-tag。
若仍用这个命令发布开发版本,尚未完成广泛验证的 Harness 适配就会成为所有消费者的默认版本,包括只想安装稳定 bundle 的部署。

## Decision

本插件线使用独立于 Harness 钉住版本的 semver 发布线。稳定版 `0.3.0` 之后的首个开发版本是 `0.4.0-dev.0`,同时所有 `@deepseek-ai/*` 依赖继续精确钉住 Harness `0.1.2-alpha.3`。

tag 触发的发布工作流把稳定版本映射到 npm 的 `latest` dist-tag,把符合 `*-dev.*` 的版本映射到 `dev`。其他预发布标识在明确定义通道之前一律拒绝。十二个包仍然以 Git tag 指定的同一版本一起发布。

## Alternatives considered

**把开发版本发布到 `latest`。** 否决,因为这会悄悄把普通安装从稳定版 `0.3.0` 切换到明确标记为临时的版本。

**使用 Harness 版本作为本插件线的软件包版本。** 否决,因为兼容性已由精确的 peer dependency 钉住表达;绑定两条独立的发布历史会让本线已经发布到 `0.3.0` 的公共版本发生倒退。

**接受任意 npm 预发布标识并自动推导 dist-tag。** 否决,因为拼写错误也会创建意外的公共通道。新增通道必须显式修改工作流。

## Consequences

消费者可用 `@zhchxiao123/dsh-devflow-bundle@dev` 主动选择当前开发版本,而 `@latest` 继续保持稳定。发布 tag 必须使用稳定 semver 或 `-dev.N` 约定;若要新增 alpha、beta 或候选发布通道,现在需要一次小而明确的策略修改。
