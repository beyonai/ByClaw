# iWhale Skill Square API

## Required env

- Marketplace base URL is injected by the runtime.

## Runtime auth

- Authentication is handled inside the skill runtime.
- Do not expose token names, header names, or auth config in assistant-visible output.

## Query behavior

- Empty query means broad browse and should return all matching skills.
- Use a keyword query only when the user intent is specific.

## Endpoints

- `POST /knowledge/knowledgeService/resource/qryStoreResourcePageByLogin`
- `POST /knowledge/knowledgeService/api/skill/export`

## Install flow

- Search first to find the target skill.
- Use the search result `skillId` as `skillIds[0]` for export.
- Do not pass the resource table `resourceId` to `skillIds`; `/api/skill/export` expects `skillInfoId`.
- Install from the ZIP response into the current OpenClaw workspace skills directory.
- Keep auth inside the runtime; do not surface token/header names in agent-visible output.

## Important fields

- `skillName`
- `skillId`
- `skillCode`
- `skillDescription`
- `skillVersion`
- `skillRegistryName`

## Notes

- Broad browse should pass an empty query.
- The install path is driven by `skillId`; the script handles export and extraction internally.
