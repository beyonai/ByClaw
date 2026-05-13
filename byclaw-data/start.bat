@echo off
REM byclaw-data — Gateway Worker 启动（Windows）
REM 用法：在本仓库根目录 byclaw-data\ 下执行 start.bat
REM

pushd "%~dp0"

uv run python -m byclaw_data.main %*

popd
