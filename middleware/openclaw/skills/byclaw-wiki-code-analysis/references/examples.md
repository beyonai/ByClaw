# Examples

## 快速分析仓库

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "explore",
  "question": "这个项目的核心架构是什么？"
}
```

## 分析指定分支

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "develop",
  "mode": "explore",
  "question": "订单模块的主流程怎么走？"
}
```

## 用户要求更新代码

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "mode": "pull"
}
```

或在分析时：

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "branch": "main",
  "refresh": true,
  "mode": "explore",
  "question": "基于最新代码分析启动流程"
}
```

## 生成 Zread Wiki

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "wiki_generate",
  "yes": true
}
```

## 读取生成的 Wiki 页面

```json
{
  "repositoryUrl": "https://github.com/org/repo.git",
  "mode": "wiki_read",
  "wikiVersion": "current",
  "wikiPage": "overview"
}
```
