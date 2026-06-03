#!/bin/bash
# sync-skills.sh — Sync skills from source to workspace (workaround for symlink-escape check)
SRC="/Users/tong/SourceCode/GitHub/ByClaw/middleware/openclaw/skills"
DST="/Users/tong/.openclaw/workspace-baiying-agent-10002045/skills"

for skill in github-code-analysis github-issues-mgmt dingtalk-todo-sync dws; do
  rm -rf "$DST/$skill"
  cp -R "$SRC/$skill" "$DST/$skill"
done

rm -rf "$DST/github-code-analysis/.cache"
echo "Skills synced to workspace."
