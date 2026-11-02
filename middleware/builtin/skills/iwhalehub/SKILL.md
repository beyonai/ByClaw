---
name: iwhalehub
description: Find and install matching resources in the iWhale Hub marketplace, including skills and future resource types. Use whenever the user asks to search, compare, validate, or install platform resources from iWhale Hub.
metadata: {"openclaw":{"requires":{"bins":["python3"]},"primaryEnv":"IWHALEHUB_API_KEY"}}
---

# iWhale Hub

Use this skill to search the platform marketplace and install matching resources.

## Runtime

- The skill runtime injects marketplace connectivity and authentication internally.
- Do not mention or surface token names, header names, or auth config in user-facing output.

## Run

```bash
python3 {baseDir}/scripts/iwhalehub.py search --query "数据分析"
python3 {baseDir}/scripts/iwhalehub.py search --query "RAG" --page-size 20
python3 {baseDir}/scripts/iwhalehub.py search --query "" --json
python3 {baseDir}/scripts/iwhalehub.py install --skill-id 803566851283717
python3 {baseDir}/scripts/iwhalehub.py install --skill-id 803566851283717 --dry-run --json
```

## Output

- Resource name, code, description, tags, version, and registry name
- Skill ID for installation

## Query guidance

- Specific request: extract the keyword and pass it to `--query`
- Broad browse request: pass an empty query so the platform returns the full list
- Avoid generic filler words such as `常用` or `技能广场` as the query value
- For installation, use the `skillId` returned by search. Do not use `resourceId` for install.
