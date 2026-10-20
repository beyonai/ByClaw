# Beyond (鲸智百应)

> 基于 React 18 + Umi Max + TypeScript 构建的企业级 AI 智能助手平台

[![CI](https://github.com/beyondAI/byclaw/actions/workflows/ci.yml/badge.svg)](https://github.com/beyondAI/byclaw/actions/workflows/ci.yml)
[![License](https://img.shields.io/badge/License-Apache%202.0-blue.svg)](LICENSE)
[![Node](https://img.shields.io/badge/Node.js-18.20.0-green.svg)](.nvmrc)

---

## 核心特性

- **AI 智能对话** - 集成多模型 AI 能力，支持文本、语音、文件等多模态交互
- **知识中心** - 企业知识库管理，支持文档上传、检索与智能问答
- **数字员工** - 可配置的 AI Agent，覆盖多种业务场景
- **工作中心** - 任务管理与协作，AI 辅助工作流
- **多端适配** - 支持 PC 端与移动端，响应式布局
- **管理后台** - 数字员工管理、仪表盘、运营监控
- **国际化** - 内置中英文支持，可扩展多语言

问答框的“技能”分类及资源引用面板支持商业版和开源版，版本配置加载期间也可展示技能列表。技能仍按当前数字员工及已有资源权限加载，支持搜索和引用。

## 租户数据源工作台

平台管理员在管理后台选择已开通租户后，可按数据库对象树浏览表。单击表名选中，双击在独立标签页打开表数据；SQL 查询也有独立标签页。表浏览和 SQL 查询结果由后端分页读取，每页最多 500 行，结果区域提供滚动条和翻页按钮。DELETE、DROP、TRUNCATE 等高危 SQL 执行前会显示目标租户及 SQL 文本，需再次确认。

数字员工编辑页中，超级助手（`ownerType` 为 `personal` 或 `personal_default`，且 `resourceCode` 以 `_main` 结尾）隐藏知识、工具、技能及数字员工组成员配置区域和选择入口。保存名称、模型、提示词等其他设置时保留原有资源关联及组成员，包括历史本体关联。普通助手型（`agentType = '001'`）和普通数字员工组的配置不受此限制；此规则仅作用于编辑页。

标准前端不再读写标签页企业上下文缓存，也不会从历史缓存附加租户请求头、恢复 WebSocket 企业选择或过滤聊天消息。HTTP、SSE 和 WebSocket 使用当前登录凭证与调用方显式传入的业务参数；历史缓存不会阻止请求或中断响应。多租户配置开关仍保留，后端租户接口与 HACU 扩展的企业空间逻辑继续由各自实现维护。

## 员工岗位管理

员工岗位管理的“组织成员”页签支持在搜索框左侧通过“批量操作”添加用户，或跨页勾选后批量移除用户；列表右侧也可逐行点击“删除”。删除前会确认，只解除用户与当前岗位的关联，保留组织成员资格、角色及其他岗位。批量添加沿用用户已有的组织和角色，重复关联自动跳过；没有组织关系的用户需先加入组织。操作按钮及提示支持中英文。

岗位成员变更由平台管理员调用 `POST /byaiService/system/position/addPositionUsers` 或 `POST /byaiService/system/position/removePositionUsers`，请求体均为 `{ "positionId": 123, "userIds": [456, 789] }`。成功后刷新成员列表，删除末页最后一项时回到有效页码。

## 知识库编辑与删除

知识库创建者及拥有有效管理授权的用户可以编辑、删除知识库，开源版、商业版和 `dataset.system`（含 `WHALE_AGENT`）使用同一权限规则。“我可用的”、官方推荐及“我的知识库”列表按后端权限展示操作，详情删除同样使用服务端 `canDelete` 权限。只有使用权限的用户不能编辑或删除。

默认个人知识库保留系统保护，不能删除；企业知识库先下架再删除，已注销资源不可编辑或恢复，资源引用检查继续生效。新增知识库的外部模式规则保持原有行为。

## 过程文件保存到个人知识库

“当前会话 → 过程文件”的文件和文件夹菜单支持“保存到个人知识库”。选择当前用户可管理的个人知识库（包含默认个人知识库）及目录（含根目录）后，底部显示“仅保存”和“仅保存并构建”；目录加载成功后可操作，再确认同名覆盖。候选知识库不依赖当前数字员工的关联关系，列表查询覆盖所有分页。文件夹保留目录层级和空目录。

商业版（`BYAI_BRAND_VERSION=commercial`）在此保存流程的确认弹窗隐藏“解析 YAML Front Matter”整块内容，并保持不解析的默认行为；开源版保留该选项。

前端复用知识库目录选择及覆盖确认，调用 `POST /byaiService/fileBrowser/saveToPersonalKnowledge`；请求增加可选 `buildAfterSave`：`false` 仅保存，`true` 保存并构建，未传时兼容原有自动构建行为。后端校验目标归属、管理权限及源文件，递归导入，并按所选模式仅对成功导入的实际文件路径提交异步构建。“仅保存”仍保留严格目录读取、逐项失败报告及文件夹层级，不提交构建。结果分别展示保存失败和构建提交失败；后者可直接重试构建，无需重新上传。构建进度沿用知识库详情页，需配置可用的知识构建服务及模型。原通用保存接口保持只导入的行为。

## 模型配置

模型表单自动填充基于完整表单存储判断用户是否修改过配置，避免未挂载的嵌套字段使思考协议及默认参数无法随模板填充。

数字员工编辑页的“一键完善”和“重新生成”提交所选模型的实例 ID，避免同一模型编码配置了多个服务地址或协议时选错实例。生成失败保留当前草稿；初次生成、重新生成和后端 JSON 修复均沿用所选实例。

资源中心编辑保存期间显示加载状态并阻止重复提交，失败后保留已编辑内容供重试。项目详情支持输入关键字自动搜索、回车或搜索按钮立即搜索及清空恢复列表；查询变更后忽略旧请求返回的结果。

## 技术栈

| 类别 | 技术 |
|------|------|
| 框架 | React 18 + Umi Max 4 |
| UI 库 | Ant Design 5 |
| 语言 | TypeScript 5 |
| 状态管理 | Zustand + dva |
| 数据请求 | Axios + React Query |
| 富文本 | Slate.js |
| 图表 | ECharts 5 |
| 样式 | Less (CSS Modules) |
| 测试 | Jest + React Testing Library |
| 代码规范 | ESLint + Prettier + Stylelint |

## 快速开始

### 前置条件

- **Node.js** >= 18.20.0（推荐使用 [nvm](https://github.com/nvm-sh/nvm) 管理版本）
- **pnpm** >= 8.0（推荐的包管理器）

### 安装与启动

```bash
# 克隆仓库
git clone https://github.com/beyondAI/byclaw.git
cd byclaw

# 安装依赖
pnpm install

# 启动开发服务器
npm run dev
```

启动后访问 `http://localhost:8000`。

### 常用命令

```bash
npm run dev          # 启动开发服务器
npm run build        # 构建生产环境包
npm run lint         # 代码检查（ESLint + Stylelint + Prettier）
npm run lint:fix     # 自动修复代码规范问题
npm run test         # 运行单元测试
npm run test:coverage # 生成测试覆盖率报告
npm run format       # 格式化代码
```

## 项目结构

```
byclaw/
├── .github/              # GitHub Actions & 模板
│   ├── workflows/        # CI/CD 流水线
│   └── ISSUE_TEMPLATE/   # Issue 模板
├── .ai/                  # AI 编程规范
├── docs/                 # 项目文档
│   ├── quick-start/      # 快速入门
│   ├── architecture/     # 架构设计
│   └── api/              # API 文档
├── src/                  # 源代码
│   ├── assets/           # 静态资源
│   ├── components/       # 公共组件
│   ├── constants/        # 常量定义
│   ├── hooks/            # 自定义 Hooks
│   ├── layout/           # 布局组件
│   │   ├── pc/           # PC 端布局
│   │   ├── mobile/       # 移动端布局
│   │   └── managerLayout/# 管理后台布局
│   ├── locales/          # 国际化
│   ├── models/           # 状态管理
│   ├── pages/            # 页面组件
│   │   ├── chat/         # AI 对话
│   │   ├── manager/      # 管理后台（仪表盘、数字员工管理）
│   ├── service/          # API 服务层
│   ├── styles/           # 全局样式
│   ├── typescript/       # 类型定义
│   └── utils/            # 工具函数
├── config/               # 构建配置
├── public/               # 静态资源（不经 webpack 处理）
├── scripts/              # 自动化脚本
├── .umirc.ts             # Umi 主配置
├── tsconfig.json         # TypeScript 配置
├── package.json          # 项目元数据
└── Dockerfile            # 容器化构建
```

## 构建与部署

### 构建生产包

```bash
npm run build

# 自定义 publicPath
npm run build -- --publicPath=/custom/path/
```

构建产物输出到 `dist/` 目录。

### 静态部署（Nginx）

```nginx
server {
    listen 80;
    server_name your-domain.com;

    location / {
        root /path/to/dist;
        try_files $uri $uri/ /index.html;
    }

    location /byaiService/ {
        proxy_pass http://your-backend-api/byaiService/;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

### 容器化部署（Docker）

```bash
# 构建镜像
docker build -t beyond-frontend .

# 运行容器
docker run -d -p 8080:8080 beyond-frontend
```

## 环境配置

### API 代理

在 `.umirc.ts` 中配置后端 API 代理：

```typescript
const target = 'http://your-api-server:8569';
```

### 路由配置

路由定义位于 `config/route.config.ts`。

## 文档

聊天 VNC 入口只选择 `status === 'RUNNING'` 且包含 `instanceEndpoints.vnc` 的沙箱。
访问地址使用后端返回的 VNC 端点，保留 token 等查询参数；相对地址基于当前网页域名解析，
并设置 `autoconnect=true`、`resize=scale`。没有符合条件的沙箱时返回空地址。

- [快速入门](docs/quick-start/README.md)
- [架构设计](docs/architecture/README.md)
- [API 文档](docs/api/README.md)
- [贡献指南](CONTRIBUTING.md)
- [变更日志](CHANGELOG.md)

## 参与贡献

我们欢迎所有形式的贡献！请阅读 [贡献指南](CONTRIBUTING.md) 了解如何参与。

## 社区

- [GitHub Issues](https://github.com/beyondAI/byclaw/issues) - Bug 反馈与功能建议
- [GitHub Discussions](https://github.com/beyondAI/byclaw/discussions) - 问答与交流

## 许可证

本项目基于 [Apache License 2.0](LICENSE) 开源。

Copyright 2026 beyondAI

## 组织发布与开源版资源入口

组织编辑页可设置多名组织管理员。
