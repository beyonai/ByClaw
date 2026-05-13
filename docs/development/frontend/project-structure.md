# 前端项目结构

本文档详细介绍 ByClaw 前端项目的目录结构和组织方式。

## 目录概览

```
byclaw-fe/
├── config/                 # 项目配置
├── public/                 # 静态资源
├── scripts/                # 构建脚本
├── src/                    # 源代码
│   ├── assets/             # 静态资源
│   ├── components/         # 公共组件
│   ├── hooks/              # 自定义 Hooks
│   ├── layouts/            # 布局组件
│   ├── locales/            # 国际化
│   ├── models/             # 全局状态
│   ├── pages/              # 页面
│   ├── services/           # API 服务
│   ├── utils/              # 工具函数
│   └── app.ts              # 应用配置
├── package.json
├── tsconfig.json
└── .umirc.ts               # Umi 配置
```

## 详细说明

### config/

项目配置文件目录。

```
config/
├── plugins/                # Umi 插件
│   ├── depend.ts           # 依赖分析
│   └── versionInfo.ts      # 版本信息
├── route.config.ts         # 路由配置
└── proxy.ts                # 代理配置
```

### public/

不参与构建的静态资源，直接复制到输出目录。

```
public/
├── image/                  # 图片资源
├── js/                     # 第三方 JS
├── svg/                    # SVG 图标
└── favicon.png             # 网站图标
```

### src/assets/

需要经过构建处理的资源。

```
assets/
├── iconfont/               # 图标字体
├── icons/                  # SVG 图标
└── svg/                    # 其他 SVG
```

### src/components/

公共组件目录。

```
components/
├── Common/                 # 通用组件
│   ├── Button/             # 按钮组件
│   ├── Table/              # 表格组件
│   └── Form/               # 表单组件
├── Chat/                   # 聊天相关
│   ├── MessageList/        # 消息列表
│   ├── MessageInput/       # 消息输入
│   └── ChatAvatar/         # 头像组件
└── Knowledge/              # 知识库相关
    ├── DocUpload/          # 文档上传
    └── DocPreview/         # 文档预览
```

**组件目录规范：**

```
ComponentName/
├── index.tsx               # 组件入口
├── index.less              # 组件样式
├── types.ts                # 类型定义（可选）
├── utils.ts                # 工具函数（可选）
└── __tests__/              # 测试文件
    └── index.test.tsx
```

### src/hooks/

自定义 React Hooks。

```
hooks/
├── useUser.ts              # 用户信息
├── usePermission.ts        # 权限检查
├── useChat.ts              # 聊天相关
├── useKnowledge.ts         # 知识库相关
└── useLocalStorage.ts      # 本地存储
```

### src/layouts/

布局组件。

```
layouts/
├── BasicLayout/            # 基础布局
│   ├── index.tsx
│   ├── index.less
│   ├── Header.tsx          # 顶部导航
│   ├── Sider.tsx           # 侧边栏
│   └── Footer.tsx          # 底部
├── BlankLayout/            # 空白布局（登录页等）
└── UserLayout/             # 用户中心布局
```

### src/locales/

国际化翻译文件。

```
locales/
├── zh-CN/                  # 中文
│   ├── global.ts           # 全局翻译
│   ├── knowledge.ts        # 知识库
│   ├── chat.ts             # 对话
│   └── user.ts             # 用户
├── en-US/                  # 英文
│   └── ...
└── index.ts                # 导出配置
```

### src/models/

全局状态管理（基于 DVA，Redux 封装，由 Umi 自动注册）。

```
models/
├── user.ts                 # 用户状态
├── chat.ts                 # 聊天状态
├── knowledge.ts            # 知识库状态
└── global.ts               # 全局状态
```

### src/pages/

页面组件，与路由对应。

```
pages/
├── Dashboard/              # 仪表盘
│   ├── index.tsx
│   └── index.less
├── Chat/                   # 对话
│   ├── index.tsx           # 聊天首页
│   ├── components/         # 页面级组件
│   └── hooks/              # 页面级 Hooks
├── Knowledge/              # 知识库
│   ├── List/               # 知识库列表
│   ├── Detail/             # 知识库详情
│   └── Upload/             # 文档上传
├── Agent/                  # 数字员工
│   ├── List/
│   ├── Detail/
│   └── Create/
├── User/                   # 用户中心
│   ├── Login/
│   ├── Register/
│   └── Profile/
└── 404.tsx                 # 404 页面
```

### src/services/

API 服务层。

```
services/
├── api/                    # API 定义
│   ├── user.ts             # 用户 API
│   ├── chat.ts             # 对话 API
│   ├── knowledge.ts        # 知识库 API
│   └── agent.ts            # 数字员工 API
├── request.ts              # 请求封装
└── types.ts                # API 类型定义
```

### src/utils/

工具函数。

```
utils/
├── format.ts               # 格式化工具
├── validate.ts             # 验证工具
├── storage.ts              # 存储工具
├── file.ts                 # 文件处理
└── index.ts                # 统一导出
```

## 文件命名规范

| 类型 | 命名规范 | 示例 |
|------|---------|------|
| 组件目录 | PascalCase | `MyComponent/` |
| 组件文件 | index.tsx | `MyComponent/index.tsx` |
| 工具函数 | camelCase | `formatDate.ts` |
| 常量文件 | UPPER_SNAKE_CASE | `CONSTANTS.ts` |
| 样式文件 | index.less | `index.less` |
| 类型文件 | types.ts | `types.ts` |

## 模块依赖关系

```
pages/
├──> components/           # 使用公共组件
├──> hooks/               # 使用自定义 Hooks
├──> services/            # 调用 API
├──> models/              # 使用全局状态
└──> utils/               # 使用工具函数

components/
├──> hooks/               # 可能使用 Hooks
└──> utils/               # 可能使用工具函数

hooks/
└──> services/            # 可能调用 API

layouts/
├──> components/          # 使用公共组件
└──> models/              # 使用全局状态
```

## 新增页面流程

1. **创建页面目录**
   ```bash
   mkdir src/pages/NewFeature
   ```

2. **创建页面组件**
   ```bash
   touch src/pages/NewFeature/index.tsx
   touch src/pages/NewFeature/index.less
   ```

3. **添加路由**
   ```typescript
   // config/route.config.ts
   {
     path: '/new-feature',
     name: '新功能',
     component: './NewFeature',
   }
   ```

4. **添加国际化**
   ```typescript
   // src/locales/zh-CN/newFeature.ts
   export default {
     'newFeature.title': '新功能',
   };
   ```

5. **添加 API 定义**
   ```typescript
   // src/services/api/newFeature.ts
   export async function getData() {
     return request('/api/new-feature');
   }
   ```
