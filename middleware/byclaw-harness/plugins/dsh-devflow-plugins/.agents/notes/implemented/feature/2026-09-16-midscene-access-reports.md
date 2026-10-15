# Agent Note: Midscene access preparation and card reports

Status: implemented

## Problem

Protected-page checks require a test identity, while a fresh browser has no user login. Reports stored only in private host directories are difficult to retain alongside task evidence.

## Decision

The workflow routes browser acceptance to the existing Midscene skills. Project settings contain only an authentication requirement and role label. The login tool imports an authorized owner-only target-scoped snapshot outside the workspace; runtime selection scopes it to project, origin and role. Missing or invalid required snapshots stop execution. A usable snapshot is not proof of server acceptance: protected cases begin with a logged-in role assertion, and SSO/MFA preparation remains separate from recorded test actions.

Card reports copy only published report assets. Runtime credentials and temporary browser material remain private. Formal runs archive automatically; exploration can name a card or be archived later. The journal registers Markdown and HTML through the existing artifact service outside transition serialization; gate runs retain card files without reentering that service.

Diagnostics resolve acceptance bindings for the selected card. An omitted card means unchecked, not missing configuration. Model metadata, login validity, deployment evidence and execution remain distinct. An unavailable completion service points to plugin/dependency inspection; exploration evidence never substitutes for required gates.

## Alternatives considered

**A third Skill.** The existing browser and acceptance procedures already own the two phases; another entry would duplicate their instructions.

**Passwords in suite actions.** Model prompts and reports retain action inputs. Authorized private snapshots avoid persisting passwords in those surfaces.

**Moving all runtime output into the card.** Runtime directories include credentials and temporary browser files. Only published assets belong with task evidence.

## Consequences

Projects can retain readable HTML alongside cards and reuse login state across fresh browsers. Users still supply an authorized identity and complete interactive login when needed. Reports may contain business page data; sanitizing known credentials does not anonymize screenshots. Snapshot expiry, server revocation and role changes require preparation again.

## Related decisions

This partially supersedes [project context](../architecture/2026-09-15-midscene-project-context.md) for login preparation and card-local report copies. That note remains authoritative for project discovery, DSH model dispatch, private runtime storage and completion policy. It also implements the private-login and card-evidence portion of the [acceptance proposal](../../proposed/feature/2026-09-14-midscene-web-acceptance.md); the broader proposal and its remaining acceptance scope stay active. Neither older record is fully superseded.
