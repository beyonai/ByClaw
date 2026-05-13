# 验证和故障排查

本指南将帮助您验证部署是否成功，并提供常见问题的解决方案。

## 部署验证清单

完成部署后，请按以下清单逐一验证：

### 1. 检查容器状态

```bash
# 中间件
cd deploy/middleware
docker compose ps

# 应用（单体或拆分）
cd ../mono  # 或 ../standalone
docker compose ps
```

**预期结果：** 所有容器状态为 `Up`

### 2. 验证中间件

#### Redis

```bash
docker exec -it byclaw-redis redis-cli -a admin123 ping
```

**预期结果：** 返回 `PONG`

#### MinIO

在浏览器访问 http://localhost:9001，使用您在 `.env` 中配置的 Access Key 和 Secret Key 登录。

#### OpenGauss

```bash
docker exec -it byclaw-opengauss gosu omm psql -d postgres -U gaussdb -c "SELECT 1;"
```

**预期结果：** 查询成功返回

### 3. 验证应用服务

#### 前端 (FE)

在浏览器访问 http://localhost:8080，应该能看到 ByClaw 的界面。

#### 后端 (BE)

```bash
curl http://localhost:8086/byaiService/actuator/health
```

或检查后端健康检查端点（如果配置了）。

#### QA 服务

```bash
curl http://localhost:8090/health
```

#### DataCloud

```bash
curl http://localhost:8087/health
```

## 常见问题排查

### 问题 1：容器不断重启

**症状：** `docker compose ps` 显示容器状态为 `Restarting`

**排查步骤：**

1. 查看容器日志
```bash
docker compose logs <service-name>
```

2. 检查中间件是否正常运行
```bash
cd deploy/middleware
docker compose ps
```

3. 检查 `.env` 配置是否正确

4. 检查端口是否被占用
```bash
lsof -i :8080
lsof -i :8086
# 检查其他端口...
```

### 问题 2：无法连接 GHCR

**症状：** `pull.sh` 失败

**解决方法：**

1. 检查 `.env` 中的 `GHCR_USER` 和 `GHCR_TOKEN` 是否正确
2. 手动测试登录
```bash
echo "your_token" | docker login ghcr.io -u "your_username" --password-stdin
```
3. 确认 Token 是否有 `read:packages` 权限

### 问题 3：OpenGauss 启动失败

**症状：** OpenGauss 容器无法启动

**解决方法：**

1. 检查数据目录权限
```bash
cd deploy/middleware
sudo chown -R 70:70 data
sudo chmod -R 755 data
```

2. 如果数据目录损坏，可以删除后重新初始化（注意：这会删除所有数据！）
```bash
cd deploy/middleware
sudo rm -rf data
mkdir -p data
sudo chown -R 70:70 data
sh stop-all.sh
sh start-all.sh
```

### 问题 4：应用无法连接数据库

**症状：** 应用日志显示数据库连接错误

**解决方法：**

1. 确认 OpenGauss 容器正在运行
2. 检查 `.env` 中的数据库配置
3. 确认容器在同一网络中
```bash
docker network inspect byclaw-network
```

### 问题 5：前端无法访问后端

**症状：** 前端界面可以打开，但功能异常

**排查步骤：**

1. 检查后端是否正常启动
2. 查看浏览器开发者工具 (F12) 的 Network 标签，查看请求错误
3. 检查 Nginx 配置 (`deploy/config/nginx-standalone.conf` 或 `nginx-mono.conf`)

### 问题 6：QA Worker 不工作

**症状：** QA 任务堆积

**排查步骤：**

1. 检查 QA Worker 日志
```bash
cd deploy/standalone
docker compose logs qa-worker
```

2. 检查 Redis 连接是否正常
3. 确认 QA Manager 和 Worker 使用相同的 Redis 配置

## 日志收集

如果需要收集日志进行排查，可以使用以下命令：

```bash
# 收集所有服务的最近 500 行日志
cd deploy/middleware
docker compose logs --tail=500 > middleware.log

cd ../standalone  # 或 ../mono
docker compose logs --tail=500 > app.log
```

## 进入容器调试

如果需要进入容器内部进行调试：

```bash
# 进入 Redis
docker exec -it byclaw-redis sh

# 进入 OpenGauss
docker exec -it byclaw-opengauss bash

# 进入应用容器（单体）
docker exec -it byclaw-all bash

# 进入应用容器（拆分）
docker exec -it byclaw-fe-standalone bash
docker exec -it byclaw-be-standalone bash
```

## 完全重置部署

如果需要完全重置部署（警告：会删除所有数据！）：

```bash
# 停止所有服务
cd deploy
sh stop-standalone.sh  # 或 sh stop-mono.sh

# 删除容器和 volumes
cd middleware
docker compose down -v

# 删除数据目录（谨慎！）
sudo rm -rf data

# 重新部署
sh start-all.sh
```

## 获取帮助

如果以上方法无法解决问题：

1. 收集所有日志
2. 记录问题复现步骤
3. 记录环境信息（OS、Docker 版本等）
4. 提交 Issue 寻求帮助

---

**恭喜！** 您已经完成了 ByClaw 的部署文档阅读。现在您可以开始使用 ByClaw 了！
