# 架构设计

## 技术栈概览

```
┌─────────────────────────────────────────────┐
│                  Beyond 前端                  │
├─────────────────────────────────────────────┤
│  UI Layer    │ React 18 + Ant Design 5      │
│  Framework   │ Umi Max 4                     │
│  State       │ Zustand + dva                 │
│  Data        │ Axios + React Query           │
│  Styling     │ Less (CSS Modules)            │
│  Build       │ Webpack (via Umi)             │
│  Testing     │ Jest + React Testing Library  │
└─────────────────────────────────────────────┘
```

## 目录结构

```
src/
├── app.ts              # 应用入口，全局配置
├── assets/             # 静态资源（图片、图标、字体）
├── components/         # 公共组件（60+ 组件）
│   ├── ChatLayoutComp/ # 对话布局组件
│   ├── MessageList/    # 消息列表
│   ├── MessagesComp/   # 消息类型组件
│   ├── QueryInput/     # 查询输入组件
│   ├── Markdown/       # Markdown 渲染
│   ├── Preview/        # 文件预览
│   └── ...
├── constants/          # 常量定义
├── hooks/              # 自定义 React Hooks（27+）
├── layout/             # 布局组件
│   ├── common/         # 公共布局
│   ├── pc/             # PC 端布局
│   ├── mobile/         # 移动端布局
│   └── managerLayout/  # 管理后台布局（侧边栏导航）
├── locales/            # 国际化资源
│   ├── zh-CN/          # 中文
│   └── en-US/          # 英文
├── models/             # 状态管理
│   ├── useAppStore.ts  # 应用全局状态 (Zustand)
│   └── useSystemStore.ts # 系统配置状态
├── pages/              # 页面组件（22+ 页面）
│   ├── chat/           # AI 对话页
│   ├── knowledgeCenter/ # 知识中心
│   ├── workCenter/     # 工作中心
│   ├── employees/      # 数字员工
│   ├── settings/       # 系统设置
│   ├── manager/        # 管理后台
│   │   ├── dashboard/  # 仪表盘
│   │   └── digitalEmployeeMgr/ # 数字员工管理
│   └── ...
├── service/            # API 服务层
│   ├── auth.ts         # 认证服务
│   ├── message.ts      # 消息服务
│   ├── session.ts      # 会话服务
│   ├── knowledgeCenter.ts # 知识中心服务
│   └── ...
├── styles/             # 全局样式
├── typescript/         # TypeScript 类型定义
└── utils/              # 工具函数（39+ 模块）
    ├── request.ts      # HTTP 请求封装
    ├── auth.ts         # 认证工具
    ├── file.ts         # 文件处理
    └── ...
```

## 状态管理

项目采用双状态管理方案：

### Zustand（推荐）

用于全局状态管理，轻量且简洁：

```typescript
// src/models/useAppStore.ts
import { create } from 'zustand';

const useAppStore = create((set) => ({
  // state...
}));
```

### dva（历史遗留）

基于 redux-saga 的状态管理，存在于部分历史模块。新功能建议使用 Zustand。

## 路由设计

路由配置集中在 `config/route.config.ts`，主要分为：

| 路由组 | 路径前缀 | 说明 |
|--------|----------|------|
| 独立页面 | `/single` | 登录页等无布局页面 |
| 移动端 | `/mobile/*` | 移动端专属页面 |
| PC 端 | `/chat`, `/knowledgeCenter` 等 | 主要业务页面 |
| 管理后台 | `/manager/*` | 管理后台页面（独立布局） |

## 数据请求

### Axios + 拦截器

统一的请求封装，包含：
- 请求/响应拦截器
- Token 自动注入
- 错误统一处理
- 请求重试

### React Query

用于服务端状态管理：
- 自动缓存
- 后台重新获取
- 分页/无限滚动

## 构建配置

核心配置在 `.umirc.ts`：

- **Webpack** - 代码分割、模块联邦
- **esbuild** - 生产环境代码压缩
- **Less** - CSS Modules + 全局变量
- **Hash** - 文件名 hash 用于缓存控制

## 测试架构

测试采用 Jest + React Testing Library，配置了多种测试环境：

| 配置文件 | 环境 | 用途 |
|----------|------|------|
| `jest.config.js` | jsdom | 基础单元测试 |
| `jest.config.dom.js` | jsdom | DOM 相关测试 |
| `jest.config.hooks.js` | jsdom | Hooks 测试 |
| `jest.config.node.js` | node | Node 环境测试 |
| `jest.config.simple.js` | node | 简单工具测试 |
| `jest.config.react.js` | jsdom | React 组件测试 |

测试文件存放在各模块的 `__tests__/` 目录下。
