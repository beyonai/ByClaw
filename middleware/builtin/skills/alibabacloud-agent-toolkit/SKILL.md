---
name: alibabacloud-agent-toolkit
description: Use as the vendored Alibaba Cloud Agent Toolkit skill pack for approved Alibaba Cloud planning, validation, and execution workflows. Load only the specific upstream skill required by an upper-layer ByClaw deployment workflow.
---

# Alibaba Cloud Agent Toolkit

This directory vendors the upstream skill content needed by ByClaw. The upstream skills remain under their original relative layout so their references continue to resolve.

## Routing

- Planning and architecture: `plugins/alibabacloud-spec-ops/skills/alibabacloud-planning/SKILL.md`
- Writing an execution plan: `plugins/alibabacloud-spec-ops/skills/alibabacloud-writing-plans/SKILL.md`
- Terraform generation: `plugins/alibabacloud-spec-ops/skills/alibabacloud-terraform-codegen/SKILL.md`
- Validation: `plugins/alibabacloud-spec-ops/skills/alibabacloud-validate/SKILL.md`
- Executing a validated plan: `plugins/alibabacloud-spec-ops/skills/alibabacloud-executing-plans/SKILL.md`
- RAM permission diagnosis: `plugins/alibabacloud-spec-ops/skills/alibabacloud-ram-permission-diagnose/SKILL.md`
- Toolkit prerequisite installation: `skills/alibabacloud-agent-toolkit-install/SKILL.md`

The ByClaw skills in `byclaw-devloop/develop/skills` remain authoritative for application registration, deployment type confirmation, target allowlists, approval, rollback policy, and audit. Do not invoke upstream execution instructions unless the ByClaw deployment plan has passed those gates.
