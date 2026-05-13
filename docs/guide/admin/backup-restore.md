# 备份与恢复

本文档介绍 ByClaw 的数据备份和恢复操作。

## 备份策略

### 备份内容

| 数据 | 位置 | 备份方式 |
|------|------|---------|
| 数据库 | OpenGauss | 逻辑备份/物理备份 |
| 文件 | MinIO | 对象存储复制 |
| 配置 | 环境变量/配置文件 | 版本控制 |
| 缓存 | Redis | 不备份（可重建） |

### 备份频率建议

| 数据类型 | 频率 | 保留周期 |
|---------|------|---------|
| 数据库全量 | 每日 | 30 天 |
| 数据库增量 | 每小时 | 7 天 |
| 文件存储 | 实时同步 | - |
| 配置 | 变更时 | 版本历史 |

## 数据库备份

### 逻辑备份（推荐）

使用 `gs_dump` 导出 SQL：

```bash
# 创建备份目录
mkdir -p /backup/byclaw/$(date +%Y%m%d)

# 执行备份
docker exec opengauss gs_dump \
  -U byclaw_user \
  -d byclaw \
  -f /tmp/byclaw_$(date +%Y%m%d_%H%M%S).sql

# 复制到宿主机
docker cp opengauss:/tmp/byclaw_*.sql /backup/byclaw/$(date +%Y%m%d)/

# 清理临时文件
docker exec opengauss rm /tmp/byclaw_*.sql
```

### 自动备份脚本

创建备份脚本 `backup-db.sh`：

```bash
#!/bin/bash

BACKUP_DIR="/backup/byclaw"
DATE=$(date +%Y%m%d_%H%M%S)
RETENTION_DAYS=30

# 创建备份目录
mkdir -p "$BACKUP_DIR"

# 执行备份
docker exec opengauss gs_dump \
  -U byclaw_user \
  -d byclaw \
  -f "/tmp/byclaw_$DATE.sql"

# 压缩备份文件
docker exec opengauss gzip "/tmp/byclaw_$DATE.sql"

# 复制到宿主机
docker cp "opengauss:/tmp/byclaw_$DATE.sql.gz" "$BACKUP_DIR/"

# 清理临时文件
docker exec opengauss rm "/tmp/byclaw_$DATE.sql.gz"

# 删除过期备份
find "$BACKUP_DIR" -name "byclaw_*.sql.gz" -mtime +$RETENTION_DAYS -delete

echo "Backup completed: byclaw_$DATE.sql.gz"
```

添加到定时任务：

```bash
crontab -e

# 每天凌晨 2 点备份
0 2 * * * /path/to/backup-db.sh >> /var/log/backup.log 2>&1
```

## 数据库恢复

### 从逻辑备份恢复

```bash
# 1. 停止应用服务
docker stop byclaw-be

# 2. 复制备份文件到容器
docker cp /backup/byclaw/byclaw_20240115_020000.sql.gz opengauss:/tmp/

# 3. 解压
docker exec opengauss gunzip /tmp/byclaw_20240115_020000.sql.gz

# 4. 恢复（方式一：恢复整个数据库）
docker exec -i opengauss gsql \
  -U byclaw_user \
  -d byclaw \
  -f /tmp/byclaw_20240115_020000.sql

# 或者方式二：重新创建数据库后恢复
docker exec opengauss gsql \
  -U gaussdb \
  -c "DROP DATABASE IF EXISTS byclaw;"
docker exec opengauss gsql \
  -U gaussdb \
  -c "CREATE DATABASE byclaw OWNER byclaw_user;"
docker exec -i opengauss gsql \
  -U byclaw_user \
  -d byclaw \
  -f /tmp/byclaw_20240115_020000.sql

# 5. 清理
docker exec opengauss rm /tmp/byclaw_20240115_020000.sql

# 6. 启动应用服务
docker start byclaw-be
```

## 文件备份

### MinIO 数据备份

```bash
# 使用 mc 客户端备份
mkdir -p /backup/minio

# 复制所有 bucket
docker exec minio mc mirror minio /backup/minio

# 或者只备份特定 bucket
docker exec minio mc mirror minio/byclaw-files /backup/minio/byclaw-files
```

### MinIO 数据恢复

```bash
# 从备份恢复
docker exec minio mc mirror /backup/minio minio
```

## 配置备份

### 备份环境变量配置

```bash
# 备份 .env 文件
cp .env "/backup/config/.env.$(date +%Y%m%d)"

# 备份 Docker Compose 配置
cp docker-compose.yml "/backup/config/docker-compose.yml.$(date +%Y%m%d)"
```

### 使用 Git 管理配置

```bash
# 初始化配置仓库
cd /backup/config
git init
git add .
git commit -m "Config backup $(date +%Y%m%d)"

# 推送到远程仓库
git push origin main
```

## 完整系统恢复

### 灾难恢复流程

1. **准备环境**
```bash
# 安装 Docker 和 Docker Compose
# 克隆项目代码
git clone https://github.com/beyondAI/byclaw.git
cd byclaw
```

2. **恢复配置**
```bash
# 恢复 .env 文件
cp /backup/config/.env.20240115 .env
```

3. **启动中间件**
```bash
cd deploy/middleware
docker-compose up -d
```

4. **恢复数据库**
```bash
# 等待数据库启动
sleep 10

# 执行数据库恢复（见上文）
```

5. **恢复文件存储**
```bash
# 恢复 MinIO 数据（见上文）
```

6. **启动应用**
```bash
cd ../mono  # 或 standalone
docker-compose up -d
```

7. **验证恢复**
```bash
# 检查服务状态
docker ps

# 检查后端健康
curl http://localhost:8086/actuator/health

# 验证数据
# 登录系统检查关键数据
```

## 备份验证

定期验证备份可用性：

```bash
# 创建测试数据库
docker exec opengauss gsql \
  -U gaussdb \
  -c "CREATE DATABASE byclaw_test;"

# 尝试恢复到测试库
docker exec -i opengauss gsql \
  -U byclaw_user \
  -d byclaw_test \
  -f /tmp/backup.sql

# 验证数据完整性
docker exec opengauss gsql \
  -U byclaw_user \
  -d byclaw_test \
  -c "SELECT COUNT(*) FROM sys_user;"

# 清理测试库
docker exec opengauss gsql \
  -U gaussdb \
  -c "DROP DATABASE byclaw_test;"
```

## 最佳实践

1. **3-2-1 备份原则**
   - 3 份数据副本
   - 2 种不同存储介质
   - 1 份异地备份

2. **定期测试恢复**
   - 每季度进行一次恢复演练
   - 验证备份文件完整性

3. **监控备份状态**
   - 设置备份失败告警
   - 监控备份存储空间

4. **文档化**
   - 记录恢复流程
   - 更新联系人和职责
