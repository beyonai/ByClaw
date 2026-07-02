# Git Auth

私有仓库不要把 token 直接传给 `code_to_wiki`。

## 正确方式

让运行环境配置环境变量，例如：

```bash
export GITHUB_REPO_TOKEN=ghp_xxx
```

然后工具参数只传变量名：

```json
{
  "repositoryUrl": "https://github.com/org/private-repo.git",
  "credentialRef": "GITHUB_REPO_TOKEN",
  "mode": "explore",
  "question": "分析这个项目的目录结构"
}
```

## 鉴权失败时

如果工具返回 `git_auth_required`：

1. 告诉用户当前仓库需要访问凭证。
2. 让用户在 OpenClaw/Gateway 运行环境中配置一个环境变量。
3. 让用户告诉你环境变量名，而不是 token 值。
4. 使用 `credentialRef` 重试。

## 分支默认值

用户没有指定分支时不追问；让 Git 使用远端默认分支。只有用户明确要求特定分支时才传 `branch`。
