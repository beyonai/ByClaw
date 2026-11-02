# Agent Note: devflow — stage executors receive model and workspace routing

Status: implemented

English | [中文](2026-08-27-devflow-driver-model-routing.zh.md)

## Problem

**Current status.** The package this note repaired is absent from the shipped line; [the Harness-owned execution decision](../architecture/2026-08-29-harness-owned-workflow-execution.md) owns the current boundary. This note remains active because its routing failure and rejected alternatives are reintroduction constraints for any future background orchestrator.

The devflow driver creates synthetic parent agents only to anchor child lineage and workspace metadata. An in-process child inherits its workspace from the parent's session header and its provider/model route from the parent unless the start request supplies `agentOptions`. A parent without `cwd` and a dispatch without those options therefore create a child missing both runtime inputs. A deployment persona that references `{{model}}` or `{{cwd}}` then fails strict prompt assembly before the child can make a model request or call a tool, and the driver parks the card `blocked` after the child ends with `stopReason: 'error'`.

The deployment already owns a current provider/model pair through the published `ctx.agentDefaultModel` service. Each card also carries its resolved devflow state root, whose parent directory is the workspace represented by that board. Repeating model selection in driver configuration or using one process-wide workspace would discard those existing authorities.

## Decision

The driver requires `agentDefaultModel` alongside its agent, subagent, and devflow services. Immediately before each `ctx.subagents.start()` call, it reads `ctx.agentDefaultModel.currentSelection()` and copies the provider/model pair into the request's `agentOptions`. The child therefore has a complete model route before prompt assembly.

The driver owns one registered, never-prompted synthetic parent per card root. That parent's session `cwd` is the parent directory of the resolved devflow root, so in-process children inherit the workspace that contains their card. Parent registrations are effects owned by the driver fiber and disappear on disposal. Cards from different roots never share a workspace anchor.

Selection happens per dispatch rather than at driver activation. A later deployment-model change affects later stage executors without rebuilding the driver plugin or changing its stage configuration.

## Alternatives considered

- **Add provider and model fields to driver configuration.** This makes the driver another owner of deployment model selection and allows its value to diverge from the settings-backed default already used by ordinary Web agents. A dedicated executor-model option remains possible when a concrete deployment needs a route distinct from the default.
- **Put the route on the synthetic parent and rely on inheritance.** Inheritance would make children runnable, but it snapshots the route when the driver activates and makes an incidental lineage object the owner of request routing. Passing `agentOptions` states the child requirement at the dispatch boundary.
- **Use one synthetic parent with the process working directory.** One workspace would make the default root work while sending cards from other roots into the wrong filesystem scope. Per-root parents preserve the driver's existing multi-workspace contract.
- **Make the harness fabricate a default route for every routeless agent.** The harness deliberately preserves empty agent options and lets entry points declare model ownership. Changing that rule would affect every synthetic-agent consumer; the driver can satisfy the published child-start contract locally.
- **Remove `{{model}}` from the deployment persona.** That hides the missing route at one prompt section while the child still cannot issue a valid model request.

## Consequences

Driver activation waits for the default-model service, which the base harness bundle provides. Every accepted stage-executor request carries an explicit provider/model pair and a parent whose session declares the card workspace, so model- and workspace-aware persona assembly resolves before the child turn begins. The real-composition driver test records both provider-facing inputs, proves that a second root receives its own workspace, and proves that driver disposal unregisters its parents.
