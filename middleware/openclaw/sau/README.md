# sau wheel

这个目录存放 [`social-auto-upload`](../../../../../Projects/social-auto-upload) 打包出来的 wheel，
供 Dockerfile 集成使用。

## 构建步骤

在 sau 项目根目录执行：

```bash
cd /path/to/social-auto-upload

# 1. 清理旧的构建产物
rm -rf build/ dist/ *.egg-info

# 2. 构建 wheel（不打包依赖，只打包本项目）
pip wheel . --no-deps -w dist/

# 3. 拷贝到本目录
cp dist/social_auto_upload-0.1.0-py3-none-any.whl \
   middleware/openclaw/sau/
```

> 版本号 `0.1.0` 来自 sau 项目的 `pyproject.toml`。
> 若版本变化，需要同步更新 Dockerfile 里的 `ARG SAU_VERSION`。

## 验证 wheel 内是否包含 stealth.min.js

```bash
unzip -l dist/social_auto_upload-*.whl | grep stealth
# 应输出: utils/stealth.min.js
```

如果看不到，说明 sau 项目的 `pyproject.toml` 里 `[tool.setuptools.package-data]`
配置被改坏了，需要先修 sau 项目再重 build。
