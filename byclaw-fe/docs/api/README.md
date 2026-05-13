# API 文档

## 服务层概览

所有 API 请求封装在 `src/service/` 目录下，按业务模块划分。

## 模块列表

| 模块 | 文件 | 说明 |
|------|------|------|
| 认证 | `auth.ts` | 登录、登出、Token 管理 |
| 会话 | `session.ts` | 对话会话的创建、列表、删除 |
| 消息 | `message.ts` | 消息发送、接收、历史记录 |
| 知识中心 | `knowledgeCenter.ts` | 知识库管理、文档上传 |
| 数字员工 | `digitalEmployees.ts` | AI Agent 配置与管理 |
| 管理后台 | `manager/` | 管理后台相关服务 |
| 管理后台-Langfuse | `manager/langfuse.ts` | Langfuse Trace 追踪 |
| 管理后台-数字员工 | `manager/digitalEmployeeMgr.ts` | 数字员工管理配置 |
| 文件 | `file.ts` | 文件上传、下载、预览 |
| 用户 | `user.ts` | 用户信息、权限 |
| 组织 | `orgMgr.ts` | 组织架构管理 |
| 搜索 | `search.ts` | 全局搜索 |
| 任务 | `task.ts` | 任务管理 |
| 反馈 | `feedback.ts` | 用户反馈（点赞/点踩） |
| 通知 | `notice.ts` | 系统通知 |
| Bot | `bot.ts` | 机器人能力 |
| ChatBI | `chatBI.ts` | 数据分析对话 |
| 助手设置 | `assistantSetting.ts` | AI 助手配置 |
| 布局 | `layout.ts` | 布局配置 |
| 成员管理 | `memberMgr.ts` | 群成员管理 |
| 智笔 | `wisdomPen.ts` | AI 写作 |
| 工作空间 | `workSpace.ts` | 工作中心 |

## API 代理配置

开发环境通过 `.umirc.ts` 配置代理：

```typescript
proxy: {
  '/byaiService': {
    target: 'http://your-api-server:8569/byaiService/',
    changeOrigin: true,
    pathRewrite: { '/byaiService': '' },
  },
  '/knowledgeService': {
    target: 'http://your-api-server:8569/knowledgeService/',
    changeOrigin: true,
    pathRewrite: { '/knowledgeService': '' },
  },
}
```

## 请求规范

### 请求封装

使用 Axios 统一封装，位于 `src/utils/request.ts`：

- 自动注入 Authorization Token
- 统一错误处理（401 跳转登录、500 提示等）
- 请求/响应拦截器

### 类型定义

所有 API 响应类型定义在 `src/typescript/` 目录下，确保类型安全。

### 使用示例

```typescript
import { getSessionList } from '@/service/session';

// 在组件中使用
const fetchSessions = async () => {
  const res = await getSessionList({ pageNo: 1, pageSize: 20 });
  return res.data;
};
```
