# 系统监控

本文档介绍 ByClaw 系统的监控和告警配置。

## 监控概览

ByClaw 监控覆盖以下层面：

- **基础设施** - CPU、内存、磁盘、网络
- **中间件** - 数据库、缓存、对象存储
- **应用服务** - 后端、前端、Python 服务
- **业务指标** - 用户数、对话量、响应时间

## 基础监控

### Docker 容器监控

使用 `docker stats` 查看容器资源：

```bash
# 实时查看
docker stats

# 查看特定容器
docker stats byclaw-be byclaw-fe
```

### 日志查看

```bash
# 查看后端日志
docker logs -f byclaw-be

# 查看最近 100 行
docker logs --tail 100 byclaw-be

# 查看带时间戳的日志
docker logs -f --timestamps byclaw-be
```

## 健康检查

### 后端健康端点

```bash
# 基础健康检查
curl http://localhost:8086/actuator/health

# 详细健康信息
curl http://localhost:8086/actuator/health/details
```

### 数据库连接检查

```bash
# 检查 OpenGauss
docker exec opengauss gsql -d byclaw -U byclaw_user -c "SELECT 1"

# 检查 Redis
docker exec redis redis-cli ping
```

## 关键指标

### 系统资源

| 指标 | 健康阈值 | 检查命令 |
|------|---------|---------|
| CPU | < 80% | `docker stats` |
| 内存 | < 85% | `docker stats` |
| 磁盘 | < 90% | `df -h` |

### 应用指标

| 指标 | 说明 | 端点 |
|------|------|------|
| 响应时间 | API 平均响应时间 | `/actuator/metrics/http.server.requests` |
| 错误率 | 5xx 错误比例 | `/actuator/metrics/http.server.requests` |
| 活跃会话 | 当前在线用户数 | `/actuator/metrics/session.active` |

## 日志聚合

### 配置日志收集

使用 Docker Compose 收集日志：

```yaml
# docker-compose.logging.yml
services:
  fluentd:
    image: fluent/fluentd
    volumes:
      - ./fluentd.conf:/fluentd/etc/fluent.conf
    ports:
      - "24224:24224"
```

### 日志轮转

配置 Docker 日志轮转防止磁盘占满：

```json
// /etc/docker/daemon.json
{
  "log-driver": "json-file",
  "log-opts": {
    "max-size": "100m",
    "max-file": "3"
  }
}
```

## 告警配置

### 简单告警脚本

创建监控脚本：

```bash
#!/bin/bash
# monitor.sh

# 检查后端健康
if ! curl -sf http://localhost:8086/actuator/health > /dev/null; then
  echo "[ALERT] Backend is down!" | tee -a /var/log/byclaw-alerts.log
  # 发送通知（邮件/钉钉/企业微信）
fi

# 检查磁盘空间
DISK_USAGE=$(df -h / | awk 'NR==2 {print $5}' | tr -d '%')
if [ "$DISK_USAGE" -gt 90 ]; then
  echo "[ALERT] Disk usage is ${DISK_USAGE}%!" | tee -a /var/log/byclaw-alerts.log
fi
```

添加到定时任务：

```bash
crontab -e

# 每分钟检查一次
* * * * * /path/to/monitor.sh
```

## 性能分析

### JVM 分析（后端）

```bash
# 进入容器
docker exec -it byclaw-be sh

# 查看 GC 情况
jstat -gc 1 1000 10

# 生成堆转储
jmap -dump:format=b,file=/tmp/heap.hprof 1

# 线程分析
jstack 1 > /tmp/thread-dump.txt
```

### 数据库慢查询

在 OpenGauss 中查看慢查询：

```sql
-- 开启慢查询日志
ALTER SYSTEM SET log_min_duration_statement = 1000;

-- 查看慢查询
SELECT * FROM pg_stat_statements 
ORDER BY total_time DESC 
LIMIT 10;
```

## 监控工具推荐

| 工具 | 用途 | 部署复杂度 |
|------|------|----------|
| Prometheus + Grafana | 指标收集和可视化 | 中 |
| ELK Stack | 日志收集和分析 | 高 |
| Uptime Kuma | 服务可用性监控 | 低 |
| Netdata | 实时系统监控 | 低 |

## 日常运维检查清单

- [ ] 检查所有服务是否正常运行
- [ ] 查看错误日志
- [ ] 检查磁盘空间
- [ ] 检查内存使用情况
- [ ] 备份数据库
- [ ] 检查安全更新

## 故障排查流程

1. **确认问题** - 用户反馈还是监控告警？
2. **收集信息** - 查看日志、指标
3. **定位原因** - 哪个服务/组件出现问题？
4. **采取措施** - 重启服务、扩容、修复
5. **验证恢复** - 确认问题已解决
6. **记录复盘** - 记录问题和解决方案
