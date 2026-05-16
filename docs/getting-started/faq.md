# 常见问题

本文档整理了使用 ByClaw 过程中的常见问题及解决方案。

## 部署相关问题

### Q: Docker 启动失败，提示端口被占用

**A:** 检查并释放以下默认端口，或修改配置使用其他端口：

```bash
# 查看端口占用
lsof -i :8080  # 前端
lsof -i :8086  # 后端
lsof -i :5432  # 数据库
lsof -i :6379  # Redis
lsof -i :9009  # MinIO API
```

修改端口：
- 前端：编辑 `deploy/config/nginx-*.conf`
- 后端：编辑 `.env` 中的 `BE_SERVER_PORT`
- 中间件：编辑 `deploy/middleware/docker-compose.yml`

### Q: OpenGauss 数据库初始化失败

**A:** 

1. 检查容器日志：
```bash
docker logs opengauss
```

2. 确保数据目录为空时才会执行初始化脚本：
```bash
# 清理数据目录（会丢失数据，谨慎操作）
docker volume rm deploy_pg_data
```

3. 手动执行初始化脚本：
```bash
docker exec -i opengauss gsql -d postgres -U gaussdb -W 'Secretpassword@123' < deploy/middleware/initdb/01_init.sql
```

### Q: 镜像拉取失败

**A:** 

1. 检查网络连接和 ghcr.io 的可访问性（所有镜像为公开仓库，无需登录）
2. 配置镜像加速器或使用代理（国内用户）
3. 手动测试：
```bash
docker pull ghcr.io/beyonai/byclaw/byclaw-redis:main
```

## 开发相关问题

### Q: 前端 `pnpm install` 失败

**A:**

1. 检查 Node.js 版本：
```bash
node -v  # 应 >= 18.20.0
```

2. 使用 nvm 切换版本：
```bash
nvm use 18
```

3. 清除缓存重试：
```bash
cd byclaw-fe
rm -rf node_modules pnpm-lock.yaml
pnpm store prune
pnpm install
```

### Q: 后端 Maven 构建失败

**A:**

1. 检查 JDK 版本：
```bash
java -version  # 应显示 21+
```

2. 检查 Maven 版本：
```bash
mvn -v  # 应 >= 3.3.9
```

3. 清理后重试：
```bash
cd byclaw-be
mvn clean
mvn -B compile
```

### Q: 前端无法连接后端 API

**A:**

1. 检查后端是否已启动：
```bash
curl http://localhost:8086/byaiService/actuator/health
```

2. 检查前端代理配置（`byclaw-fe/.umirc.ts`）：
代理默认将 `/byaiService` 转发到 `http://localhost:8086`，确保后端已启动在该端口。

### Q: 登录页面提示 "系统错误"

**A:**

1. 检查后端日志是否有数据库连接错误
2. 确认数据库表已正确创建
3. 检查初始数据是否已插入：
```sql
SELECT * FROM sys_user LIMIT 1;
```

## 功能相关问题

### Q: AI 对话无响应

**A:**

1. 检查 AI 模型配置是否正确（API Key、Endpoint）
2. 查看后端日志中的调用错误
3. 确认网络可以访问模型服务

### Q: 文件上传失败

**A:**

1. 检查 MinIO 是否正常运行
2. 检查 `.env` 中的 MinIO 配置
3. 检查 bucket 是否已创建

### Q: 知识库文档解析失败

**A:**

1. 检查文档格式是否支持（PDF、DOCX、TXT、MD 等）
2. 检查文件大小是否超过限制
3. 查看 `byclaw-data` 服务的日志

## 性能相关问题

### Q: 系统运行缓慢

**A:**

1. 检查资源使用情况：
```bash
docker stats
```

2. 增加内存配置：
```bash
# 编辑 deploy/*/docker-compose.yml
services:
  byclaw-be:
    deploy:
      resources:
        limits:
          memory: 2G
```

3. 检查数据库慢查询日志

### Q: 前端页面加载慢

**A:**

1. 检查网络请求耗时（浏览器 DevTools Network 面板）
2. 启用 gzip 压缩（生产环境 Nginx 配置）
3. 检查是否开启浏览器缓存

## 其他问题

### Q: 如何重置管理员密码

**A:** 直接修改数据库：

```sql
-- 假设使用默认加密方式
UPDATE sys_user 
SET password = '新密码的加密值'
WHERE username = 'admin';
```

### Q: 如何备份数据

**A:**

```bash
# 备份数据库
docker exec opengauss gs_dump -U byclaw_user -d byclaw -f /tmp/backup.sql

# 备份 MinIO 数据
docker exec minio mc mirror minio/bucket /backup/bucket
```

### Q: 如何查看日志

**A:**

```bash
# Docker 部署
docker logs -f byclaw-be
docker logs -f byclaw-fe

# 本地开发
cd byclaw-be
tail -f logs/application.log
```

## 仍未解决？

如果以上方案无法解决你的问题：

1. 查看 [GitHub Issues](https://github.com/beyondAI/byclaw/issues) 是否有相似问题
2. 创建新的 Issue，提供以下信息：
   - 问题描述
   - 复现步骤
   - 环境信息（OS、Docker 版本等）
   - 相关日志片段
