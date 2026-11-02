# Python 环境参考

系统已预装 Python 3.12（`/usr/local/bin/python3`）及 `by-framework`、`by-datacloud` 依赖，无需手动安装。

## 环境变量

| 变量 | 说明 | 必需 |
|------|------|------|
| `BEYOND_TOKEN` | 门户服务认证 Token | ✅ |
| `USER_CODE` | 当前用户编码 | ✅ |
| `BE_DOMAINNAME` | 默认 `ByaiService` | 否 |
| `REDIS_HOST` | Redis 主机 | 否 |
| `REDIS_PORT` | 默认 `6379` | 否 |
| `REDIS_PASSWORD` | Redis 密码 | 否 |

## 脚本路径约定

所有脚本以 skill 根目录为基准，通过 `/usr/local/bin/python3` 执行：

```bash
export BE_DOMAINNAME=${BE_DOMAINNAME:-ByaiService}

# 结构化本体
/usr/local/bin/python3 scripts/ontology/structured/<script>.py '<JSON>'

# 非结构化本体
/usr/local/bin/python3 scripts/ontology/unstructured/<script>.py '<JSON>'

# 周报/会议纪要
/usr/local/bin/python3 scripts/weekly-report/<script>.py [--args]
```

> `list_mounted_resources.py` 的 `resource_id` 是 Agent 自身的数字后缀（如 `agent-10014603` → `10014603`），**不是** baiying_call 用的业务 resourceId。

## 环境检查

```bash
bash scripts/setup.sh    # 一键检查环境是否就绪
bash scripts/check_env.sh # 快速检查（输出通过/失败）
```
