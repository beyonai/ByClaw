# 前端开发入门

本文档介绍 ByClaw 前端项目的开发规范和工作流程。

## 环境准备

### 前置要求

- Node.js >= 18.20.0（项目通过 Volta 锁定）
- pnpm 9+（项目通过 packageManager 字段锁定 pnpm 9.0.0）

### 安装依赖

```bash
cd byclaw-fe
pnpm install
```

### 启动开发服务器

```bash
pnpm dev
```

访问 http://localhost:8000

## 项目结构

```
byclaw-fe/
├── config/                 # 配置文件
│   ├── route.config.ts     # 路由配置
│   └── ...
├── public/                 # 静态资源
├── src/
│   ├── assets/             # 图片、图标等资源
│   ├── components/         # 公共组件
│   ├── hooks/              # 自定义 Hooks
│   ├── locales/            # 国际化
│   ├── models/             # 数据模型
│   ├── pages/              # 页面组件
│   ├── services/           # API 服务
│   ├── utils/              # 工具函数
│   └── app.ts              # 应用入口配置
├── package.json
└── .umirc.ts               # Umi 配置
```

## 开发规范

### 组件开发

#### 函数组件

```typescript
// 使用箭头函数
import React from 'react';
import { Button } from 'antd';

interface Props {
  title: string;
  onClick?: () => void;
}

const MyComponent: React.FC<Props> = ({ title, onClick }) => {
  return (
    <div>
      <h1>{title}</h1>
      <Button onClick={onClick}>点击</Button>
    </div>
  );
};

export default MyComponent;
```

#### 组件目录结构

```
components/
├── MyComponent/
│   ├── index.tsx           # 组件入口
│   ├── index.less          # 样式
│   ├── types.ts            # 类型定义
│   ├── utils.ts            # 组件工具函数
│   └── __tests__/          # 测试文件
│       └── index.test.tsx
```

### 状态管理

#### 全局状态 (DVA Model)

```typescript
// src/models/userModel.ts
import { Effect, Reducer } from 'umi';

export interface UserModelState {
  userInfo: UserInfo | null;
}

export default {
  namespace: 'user',
  state: { userInfo: null } as UserModelState,
  reducers: {
    setUserInfo(state, { payload }) {
      return { ...state, userInfo: payload };
    },
  },
  effects: {
    *fetchUserInfo(_, { call, put }) {
      const data = yield call(getUserInfoApi);
      yield put({ type: 'setUserInfo', payload: data });
    },
  },
};
```

#### 服务端状态 (React Query)

```typescript
// hooks/useKnowledgeBase.ts
import { useQuery } from '@tanstack/react-query';

export const useKnowledgeBase = (id: string) => {
  return useQuery({
    queryKey: ['knowledgeBase', id],
    queryFn: () => fetchKnowledgeBase(id),
  });
};
```

### API 请求

项目使用自定义 Axios 封装（`src/service/common/request.ts`），支持 HMAC 签名、Token 管理和并发控制。

```typescript
// services/agent.ts
import { get, post } from '@/service/common/request';

export async function getAgentList(params: AgentQueryParams) {
  return get<AgentListVO>('/byaiService/api/agent/list', { params });
}

export async function createAgent(data: AgentCreateReq) {
  return post<void>('/byaiService/api/agent/create', data);
}
```

响应格式：`{ code: 0, msg: 'success', data: T }` — code 为 0 表示成功。

### 样式规范

#### 使用 CSS Modules

```typescript
// MyComponent.tsx
import styles from './index.less';

const MyComponent = () => {
  return <div className={styles.container}>内容</div>;
};
```

```less
// index.less
.container {
  padding: 24px;
  background: #fff;
  
  .title {
    font-size: 16px;
    font-weight: 500;
  }
}
```

#### 样式变量

使用 Ant Design 的样式变量：

```less
@import '~antd/es/style/themes/default.less';

.my-component {
  color: @primary-color;
  font-size: @font-size-base;
}
```

## 路由配置

### 配置式路由

```typescript
// config/route.config.ts
export default [
  {
    path: '/',
    component: '@/layouts/BasicLayout',
    routes: [
      {
        path: '/',
        redirect: '/dashboard',
      },
      {
        path: '/dashboard',
        name: '仪表盘',
        component: './Dashboard',
      },
      {
        path: '/knowledge',
        name: '知识库',
        routes: [
          {
            path: '/knowledge/list',
            name: '列表',
            component: './Knowledge/List',
          },
          {
            path: '/knowledge/detail/:id',
            name: '详情',
            component: './Knowledge/Detail',
            hideInMenu: true,
          },
        ],
      },
    ],
  },
];
```

## 国际化

### 添加翻译

```typescript
// src/locales/zh-CN.ts
export default {
  'knowledge.title': '知识库',
  'knowledge.create': '新建知识库',
  'knowledge.upload': '上传文档',
};
```

### 使用翻译

```typescript
import { useIntl } from 'umi';

const MyComponent = () => {
  const intl = useIntl();
  
  return (
    <Button>
      {intl.formatMessage({ id: 'knowledge.create' })}
    </Button>
  );
};
```

## 测试

### 单元测试

```typescript
// __tests__/utils.test.ts
import { formatFileSize } from '../utils';

describe('formatFileSize', () => {
  it('should format bytes to KB', () => {
    expect(formatFileSize(1024)).toBe('1 KB');
  });
  
  it('should format bytes to MB', () => {
    expect(formatFileSize(1024 * 1024)).toBe('1 MB');
  });
});
```

### 运行测试

```bash
# 运行所有测试
pnpm test

# 运行特定文件
pnpm test MyComponent

# 覆盖率报告
pnpm test --coverage
```

## 常用命令

```bash
# 开发
pnpm dev

# 构建
pnpm build

# 代码检查
pnpm lint

# 自动修复
pnpm lint:fix

# 类型检查
pnpm tsc

# 测试
pnpm test
```

## 调试技巧

### VS Code 调试配置

```json
// .vscode/launch.json
{
  "version": "0.2.0",
  "configurations": [
    {
      "name": "Chrome Debug",
      "type": "chrome",
      "request": "launch",
      "url": "http://localhost:8000",
      "webRoot": "${workspaceFolder}/byclaw-fe",
      "sourceMapPathOverrides": {
        "webpack:///src/*": "${webRoot}/src/*"
      }
    }
  ]
}
```

### React DevTools

安装浏览器扩展，用于：
- 查看组件树
- 检查 Props 和 State
- 性能分析

## 最佳实践

1. **组件拆分** - 单一职责，避免过大组件
2. **类型安全** - 使用 TypeScript 严格模式
3. **性能优化** - 使用 memo、useMemo、useCallback
4. **代码复用** - 提取公共组件和 Hooks
5. **错误处理** - 使用 Error Boundary
