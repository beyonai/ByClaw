param(
    [ValidateSet("init", "update", "stop", "help")]
    [string]$Action = "help"
)

# 兼容入口：允许在 deploy/ 目录内执行 .\deploy.ps1 init|update|stop。
& "$PSScriptRoot\..\deploy.ps1" -Action $Action
