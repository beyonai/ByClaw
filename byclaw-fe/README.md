# Beyond (鲸智百应)

### 个人网盘容量业务门控

`BYCLAW_PERSONAL_STORAGE_ADMISSION_ENABLED` 是前端构建期配置，默认 `false`。关闭时聊天和文件请求不等待个人网盘 readiness，也不弹开通/容量模态框；真实 API 失败继续按原错误路径显示并拒绝请求。BE、Platform 同时保持该开关关闭；修改前端配置后须重启开发服务或重新构建。该开关不改变文件访问权限、空间身份或云端物理配额。

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

团队协作从“任务执行计划”查看，标题栏隐藏“团队活动”。展开计划后可查看任务负责人；点击任务标题打开最新一次执行，也可选择历史执行轮次，直接定位到该轮消息。重试、转派及同一执行内的多轮会话分别保留。旧计划会匹配同一团队的任务负责人，并提供与原“团队活动”相同的成员会话入口，按钮明确标为“成员会话”；没有精确绑定的历史轮次显示“暂无执行记录”，不会冒充已定位的历史消息。

普通子代理也从计划步骤进入，标题栏继续隐藏子代理数量入口。Harness 根据父会话中的原生子代理创建记录，将子代理绑定到派发时唯一的进行中步骤，并投影每轮真实执行记录；点击任务标题打开最新执行，也可按“第几轮／对话”定位历史消息。历史记录从持久化会话日志恢复，不依赖数字员工组或团队成员快照；普通计划使用“主代理／子代理”状态文案。派发时没有进行中步骤、同时存在多个进行中步骤，或旧记录缺少关联证据时，不猜测对应关系；主代理自己处理且未委派的步骤也不会生成子代理链接。

执行中的步骤使用蓝色背景、旋转图标和“执行中”标记，收起计划时标题栏仍显示运行图标；待执行步骤显示灰色“待执行”标记，便于区分等待与正在执行。

任务计划标题栏同时订阅会话运行状态和团队快照：团长、成员、调度、等待用户、等待依赖、失败、取消及状态同步中会分别提示，避免步骤快照延迟时被误认为已结束或卡死。已绑定数字员工的步骤会显示其头像；头像来自现有员工缓存，无法匹配时保留原有文字布局。

同一会话中，后台刷新计划或任务完成会保留用户的展开/收起选择；切换会话时恢复默认收起。

窄面板中的任务名称完整换行，步骤和负责人另行展示；标题栏的进度统计也可换行，避免内容被截断。

## 语音消息与模型配置

PC 输入框发送按钮旁点击“发语音”开始录音，右下角录音条显示取消按钮、实时音量波形和秒数；点击绿色箭头发送，点击 X 丢弃。移动端打开语音入口后按住说话，松开发送，上滑取消。录音最长 60 秒，PC 达到上限后保留录音等待用户发送。

语音以原始 MP3 上传并作为 `VOICE` 消息交给当前数字员工（默认会话交给超级助手），历史消息保留音频和时长。点击语音气泡播放或暂停；点击旁边下拉按钮或右键打开菜单，选择“语音转文字”通过后端全局默认 ASR 模型转换。转换结果展开在气泡下方，菜单可收起文字；再次展开复用本次已转换的文字。助手返回的 MP3 语音摘要在答复附件下方单独显示；鉴权读取真实音频时长后以秒展示，并支持播放、语音转文字和收起文字。

模型管理支持 ASR、TTS、文生图等模型类型，每种类型可独立设置一个已启用的默认模型。请先填写真实接口、令牌和模型代码，保存并调试成功后启用、设为对应类型默认；示例值不能代替可用模型配置。ASR 调试可直接上传 MP3，TTS 调试输入文本后返回调用结果。

聊天模型选择器根据 Redis 中的最近检查结果显示告警图标；当前模型检查失败时使用 Ant Design Select 的 error 状态标红。选择模型时不自动弹出提示，仅在悬停或点击告警图标时查看详情。选择模型仅使用缓存，不发起模型检查，也不改变 24 小时检查期限；检查恢复正常后红框自动消失。

类型选项来自系统参数 `SYSTEM_MODEL_TYPE`。ASR、TTS、文生图及后续新增类型的提供商分别从 `SYSTEM_MODEL_<类型>_PROVIDER_NAME` 加载；现有 LLM、Embedding、Rerank 继续共用 `SYSTEM_MODEL_PROVIDER_NAME`。每项的 `paramValue` 是提供商标识，名称由 `paramName` / `paramEnName` 展示，`paramDesc` 可包含 JSON 元数据：`adapter`、`modelProtocol`、`apiEndpoint`、`modelCode`、`logo`、`options`。选择提供商后自动填充协议、地址、模型代码和扩展参数；可继续修改后保存。无效或旧版普通文本描述不会覆盖连接设置。提供商图标遵循前端部署的 `publicPath`，缺少图标时显示通用图标。

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

商业版（`BYAI_BRAND_VERSION=commercial`）在资源中心的模型页隐藏“用量概览”标题、月度配额进度及限额说明，保留 Total Tokens 和按模型用量统计。开源版维持原展示；版本配置加载中或读取失败时隐藏月度配额区域，避免商业版短暂显示限额信息。

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


## 语音偏好与语音消息

个人「常规」设置提供「语音自动播报」与「输入语音自动转文字」两个 Ant Design Switch，默认开启。偏好按账号保存在当前浏览器，刷新后保留，不跨设备同步。

- 自动播报只适用于当前页面收到并完成的数字员工实时回复；同一回复的多个语音片段按展示顺序播放。历史加载、返回已完成的缓存会话、重新打开开关不会补播旧语音。
- 切换会话会取消待播片段。手动播放优先，并使尚未解析完成的旧自动播报失效。浏览器阻止自动播放时仍可点击气泡播放。
- 新输入语音自动展开 ASR 文字；关闭后保留「语音转文字」菜单。自动识别失败不循环重试，用户可手动重试；历史消息不会批量请求 ASR。
- 语音制品同时从正文路径和结构化工具结果提取，规范化路径后去重；即使最终正文只列文件名，多段语音仍展示各自可播放、可转写的气泡。

回归测试：`pnpm exec jest src/components/MessageList/components/VoiceMessage src/components/MessageList/components/ReplyFileArtifacts src/pages/settings/__tests__/index.test.tsx src/utils/__tests__/imageArtifacts.test.ts --runInBand`。

任务步骤全部完成后，若同一回合的团长仍在运行且没有执行中的子代理或待用户处理的交互，计划标题栏显示“团长正在汇总”。该提示订阅现有会话运行状态，不新增轮询；团长结束、失败或等待用户输入后自动隐藏。缺少回合匹配证据时不推断汇总状态。
## 组织发布与开源版资源入口

新增和编辑组织均可设置多名组织管理员；组织树「… → 编辑组织」与组织名称旁的编辑按钮均可打开编辑表单。
管理员选择弹窗左侧为当前企业的组织树，右侧仅显示所选组织的直属有效用户，不包含子组织用户；
支持跨组织多选、回显和取消选择，保存后选中用户加入目标组织并获得组织管理员角色。
管理员加载失败时可重试，加载成功前禁止保存，避免误清空已有管理员。
数字员工发布页支持全公司或多个组织，各组织独立审核；
共享企业版本的配置更新需全部已发布组织通过后统一切换。审核中心区分员工使用申请与管理申请。
组织管理员在发布列表和详情仅能看到自己管理范围内的目标行；发布人、平台管理员和超管可查看完整范围。
企业推荐卡片（含员工组）底部显示“所属组织”，使用后端 `audienceOrganizations`，只展示生效且当前用户可见的组织。
显示前两个组织名称及 `+N`，悬停查看全部名称；全公司范围显示“全公司”，历史未配置范围显示“未设置组织”。
“我的员工”和收藏页继续沿用原卡片信息。

部署配置 `BYAI_BRAND_VERSION=commercial` 时，对话输入框「+」菜单和数字员工编辑页保留工具、知识入口。
开源版在这两个位置隐藏工具和知识，保留技能入口；编辑已保存员工时保留既有工具及知识绑定，隐藏入口不会清空配置。
资源中心和商业版管理流程保持现有入口。版本配置尚未加载时先隐藏这两类入口，避免开源版短暂展示。

### 回复文件卡片去重

助手回复中的会话文件链接统一由消息附件组件校验和展示。原始 UserFS 路径、`/by` 沙箱路径、
`{{file_preview_prefix}}` 链接及未指定存储桶的同源 `commonFile` 预览／下载地址归一为同一文件身份；外部链接和显式存储桶链接仍按普通链接处理。
消息附件与解析结果按路径去重，只有没有路径的旧附件才按名称兜底；不同目录下的同名文件分别展示。
重复的正文链接只产生一个文件卡片，下载及预览继续使用现有会话鉴权接口。


沙箱运行记录分别展示和筛选「记录状态」(`status`) 与「实际状态」(`providerStatus`)。远端清单未观察到实例时显示「未知」，不据此推断实例已删除。默认不过滤两种状态；记录已释放但远端仍在启动、运行或释放时，可通过释放操作重试精确回收该实例，后端保留权限和后继实例保护校验。
