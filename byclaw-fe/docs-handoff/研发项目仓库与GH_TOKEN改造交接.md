# 研发项目：GH_TOKEN 提醒 + 常用变量 + 仓库多平台(provider)改造 · 交接文档

> 状态快照。多任务，前几项已完成，最后一项(仓库 provider)做到一半被打断。
> 恢复时**不要**盲目 build/verify，先按“未完成清单”接着写代码，再统一校验。

---

## 一、背景与总目标

围绕 ByClaw 研发项目(develop project)做的一串体验/能力改造，跨 3 个仓库：

- 前端 `byclaw-fe`(UmiJS/max + React + antd + i18n)
- 后端 `byclaw-be`(Java / Spring / MyBatis-Plus)
- 中间件/DB 迁移 `byclaw-middleware`(SQL migrations)

关键领域知识：
- 研发项目依赖个人参数 `GH_TOKEN`，agent 在会话沙箱里用它 clone/push 私有仓库。**后端不执行 git**，clone 指令写在 prompt 模板里交给 agent。
- `GH_TOKEN` 存储 = `UserPrivateParam` 表 `paramKey='GH_TOKEN'`。前端 `checkGitHubPat()`(`/byaiService/devloop/pat/github/check`)查的就是它，返回 `{hasPat, last4}`。
- `t()` 前缀：`ProjectDetailModal` 里 `t(id)` = `intl.formatMessage({ id: \`projectSpace.detail.${id}\` })`。

---

## 二、已完成任务(代码已落，尚未提交)

### 任务 A — 聊天录入只在右侧开新会话，左侧详情面板不变
文件：`src/layout/sider/components/ProjectSpaceList/ProjectDetailModal.tsx`
- `openChatRequirementEntry`：去掉了 `onBack()`(不再卸载左侧面板)，并在导航前显式关闭渠道配置/账号管理覆盖层(`channelPanelOpen`→`setChannelPanelOpen(false)+clearDetailPanel()`、`operationAccountPanelOpen`→`handleCloseOperationAccountPanel()`)，避免新会话被残留覆盖层遮挡。
- 发送 `message.info(t('requirement.addMenu.chatTip'))` 轻提示。
- i18n key：`projectSpace.detail.requirement.addMenu.chatTip`(zh-CN.ts / en-US.ts 已加)。

### 任务 B — 研发项目未配 GH_TOKEN 的提醒条
文件：`ProjectDetailModal.tsx` + settings 页 + i18n
- 新增 state `patChecked`(在原 `hasPatSaved` 附近)。
- 改造原 `checkGitHubPat` 的 useEffect：`setHasPatSaved(!!res?.hasPat)` + `.finally(()=>setPatChecked(true))`，避免结果未回时提醒条闪现。
- import 增加 antd `Alert`。
- 新增 `openGithubTokenGuide()`：`Modal.confirm`(标题/正文/「去设置」/「稍后再说」)，确定则 `navigate('/settings', { state: { tab: 'personalParams' } })`。
- 在 `detailTabsWrap` 上方渲染：`isDevelopProject && patChecked && !hasPatSaved` 时显示可关闭 `Alert`(warning)，文案可点击触发 `openGithubTokenGuide`。
- CSS：`index.module.less` 加 `.githubTokenAlert` / `.githubTokenAlertText`。
- settings 页 `src/pages/settings/index.tsx`：import `useLocation`，`activeMenu` 初始值读 `location.state?.tab`(仅接受 `personalParams`/`email`，否则 `general`)。
- i18n(注意在 `src/locales/{zh-CN,en-US}.ts`)：
  - `projectSpace.detail.githubToken.reminder.alert` / `.title` / `.content` / `.goSetting` / `.later`

### 任务 C — 个人参数“常用变量”快捷选择
文件：`src/pages/settings/components/PersonalParamSettings/index.tsx` + less + i18n
- import 增加 antd `Dropdown`、`DownOutlined`、`type MenuProps`。
- 常量 `COMMON_PARAM_KEYS`(可扩展)：目前仅 `{ key:'GH_TOKEN', descriptionId:'settings.params.common.ghToken.desc' }`。后端唯一约定变量就是 GH_TOKEN。
- `handlePickCommonKey(key)`：填 key；描述为空时补默认描述(不覆盖用户已填)。
- key 输入框 `addonAfter`：仅新增态(非 editing)显示「常用变量」`Dropdown`。
- CSS：`.commonKeyTrigger`。
- i18n 在 `src/locales/{zh-CN,en-US}/secondEdition.ts`(注意是 secondEdition，不是主文件)：
  - `settings.params.common.pick`、`settings.params.common.ghToken.desc`

### 任务 D — 仓库列表 URL 显示 `-` 修复
文件：`ProjectDetailModal.tsx`
- 新增模块级 `getRepoDisplayUrl(repo)`：优先 `repoUrl`；否则 `repoFullName` 形如 `owner/repo`(含斜杠、非完整 URL)时按平台 host 拼 `https://{host}/{fullName}`(去 `.git`)；都没有返回空。
- 仓库列表描述行(原 `{repo.repoUrl || '-'}`)改为 `{getRepoDisplayUrl(repo) || '-'}`。
- ⚠️ 用户反馈“还是显示 -”。**未定位根因**就转入 provider 改造(见下)。可能原因：dev server 未热更新、或该数据 `repoFullName` 为空/非 owner/repo 格式。恢复时需实际验证一条数据。

---

## 三、进行中任务 E — 仓库支持 github/gitlab/gitea(默认 github)

### 已拍板的范围
- 新增 `provider` 字段，取值 `github|gitlab|gitea`，默认 `github`。
- 深度 = **仅平台类型**(不加自定义 host 字段)。host 用公共域名；自建/私有实例靠“仓库地址(repoUrl)”字段填完整 URL 兜底。
- **暂不做** gitlab/gitea 的 issue 扫描、代码对比(它们依赖各平台 API，是 GitHub 专用能力，属独立较大工作量)。保持 github-only，代码里注明边界。
- DB 迁移放 **V0.4.0**(用户明确：不要动 V0.3.0)。

### 已完成(FE，代码已落)
文件：`src/service/devloop.ts`
- 新增 `export type RepoProvider = 'github' | 'gitlab' | 'gitea';`
- `DevloopProjectRepo` 加可选 `provider?: RepoProvider;`
- `createProjectRepo` 入参加 `provider?: RepoProvider;`

文件：`ProjectDetailModal.tsx`
- import 从 `@/service/devloop` 增加 `type RepoProvider`。
- `RepoOption` 类型加 `provider?: RepoProvider;`
- 新增模块级常量 `REPO_PROVIDER_HOSTS`：`{ github:'github.com', gitlab:'gitlab.com', gitea:'gitea.com' }`。
- `getRepoDisplayUrl` 改为按 `repo.provider ?? 'github'` 取 host 拼接。
- 新增模块级 `getDefaultRepoForm()`：返回 `{ repoFullName:'', repoUrl:'', defaultBranch:'main', repoType:'code', provider:'github' }`。
- `repoForm` state 类型加 `provider: RepoProvider`，初值改为 `getDefaultRepoForm()`。
- **7 处** reset 站点(原字面量 `{ repoFullName:'', repoUrl:'', defaultBranch:'main', repoType:'code' }`)已用 perl 全量替换为 `setRepoForm(getDefaultRepoForm())`(state 初始 + 6 处调用)。

### 未完成清单(恢复后按序做)

**FE**
1. `renderRepoFormModal`(约 6100+ 行)：在“仓库全名”上方加「代码平台」选择(Radio.Group 或 Select)，绑定 `repoForm.provider`，选项 github/gitlab/gitea，默认 github。
2. `handleCreateRepo`(约 3418 行)：`createProjectRepo({...})` 调用补 `provider: repoForm.provider`。
3. i18n(`src/locales/{zh-CN,en-US}.ts`，projectSpace.detail 命名空间)：
   - `repository.field.provider`(如“代码平台”)
   - `repository.provider.github` / `.gitlab` / `.gitea`(可直接用 GitHub/GitLab/Gitea 字面)
4. (可选)仓库列表项展示 provider 标签。

**BE**(`byclaw-be`)
5. `entity/devloop/ProjectRepo.java`：加 `private String provider;`
6. `dto/devloop/ProjectRepoDTO.java`：加 `private String provider;`
7. `application/service/devloop/ProjectApplicationService.java` → `insertProjectRepo(...)`：
   `repo.setProvider(合法值? dto.getProvider() : "github")`(校验 github/gitlab/gitea，缺省 github)；
   `createProjectRepo(...)` 的返回 map 加 `result.put("provider", repo.getProvider())`。
8. `application/service/devloop/DevloopApplicationService.java` → `buildTaskPrompt(...)`(约 2380 行)：
   `${repoUrl}` 缺省拼接时按 provider host 拼(不再写死 github.com)。参考 host 映射同 FE。
   注意：真正 clone 用的 host 还取决于 prompt 模板 DML(见下)。

**DB**(`byclaw-middleware`)
9. 新建 `deploy/migrations/versions/V0.4.0/V0.4.0__ddl.sql`：
   `ALTER TABLE byai.byai_project_repo ADD COLUMN provider VARCHAR(20) DEFAULT 'github';`
   + `COMMENT ON COLUMN ... IS '代码平台 github/gitlab/gitea';`
   (参考现有 V0.3.0 目录命名：`V0.3.0__ddl.sql` / `V0.3.0__dml.sql`)
10. 同步 `deploy/middleware/initdb/02_ddl.sql` 的 `byai_project_repo` 建表(约 1577 行)加 `provider` 列 + COMMENT。
11. ⚠️ **clone host 写死点**：`deploy/migrations/versions/V0.3.0/V0.3.0__dml.sql` 第 19-24 行 prompt 模板里
    `git clone https://$GH_TOKEN@github.com/${repoFullName}.git` 写死 `github.com`。
    用户指示：**不要改 V0.3.0**，在 V0.4.0 用 update 语句更新该 prompt(`byai_ai_prompt` 表，code=`DEVLOOP_TASK_START_PROMPT`)。
    真正让 gitlab/gitea 能 clone，核心就是这条模板要按 provider host + 对应 token 变量。
    ⚠️ 但目前只存 provider 类型、且 token 只有 GH_TOKEN。gitlab/gitea 的令牌变量策略**尚未设计**——恢复时需和用户确认(是否复用 GH_TOKEN、还是新增 GL_TOKEN/GITEA_TOKEN 个人参数)。此项可能超出“仅平台类型”范围，先做 1-10，第 11 项单独确认。

### 当前中间态风险
- FE 处于**未编译验证**状态：下拉未加、`handleCreateRepo` 未传 provider，但类型/常量/reset 已改。不影响编译(provider 可选)，但功能未闭环。
- 尚未跑 eslint/tsc/build。已知本文件存在**预存**(非本次引入)的 lint：`handleStartTask` 未使用(~3533)、`== null`(~3594)——属此前未提交的需求拆分/Integration 改动，勿归咎本次。

---

## 四、涉及文件汇总

前端 `byclaw-fe`：
- `src/layout/sider/components/ProjectSpaceList/ProjectDetailModal.tsx`（A/B/D/E 主战场）
- `src/layout/sider/components/ProjectSpaceList/index.module.less`（B 的 Alert 样式）
- `src/pages/settings/index.tsx`（B 的 tab 直达）
- `src/pages/settings/components/PersonalParamSettings/index.tsx` + `index.module.less`（C）
- `src/service/devloop.ts`（E 的类型/接口）
- `src/locales/zh-CN.ts` / `en-US.ts`（A/B/D/E 的 projectSpace.detail.* 文案）
- `src/locales/zh-CN/secondEdition.ts` / `en-US/secondEdition.ts`（C 的 settings.params.* 文案）

后端 `byclaw-be`（E，未开始）：
- `entity/devloop/ProjectRepo.java`、`dto/devloop/ProjectRepoDTO.java`
- `application/service/devloop/ProjectApplicationService.java`、`DevloopApplicationService.java`

DB `byclaw-middleware`（E，未开始）：
- 新建 `deploy/migrations/versions/V0.4.0/V0.4.0__ddl.sql`（+ 可能 `__dml.sql`）
- `deploy/middleware/initdb/02_ddl.sql`

---

## 五、提交建议(全部未提交)

三组相对独立，建议分开 commit：
1. 任务 A/D：聊天录入不遮挡 + 仓库 URL 显示兜底。
2. 任务 B/C：GH_TOKEN 提醒条 + settings tab 直达 + 常用变量快捷选择。
3. 任务 E：仓库 provider 多平台(FE+BE+DB) —— **待做完再提交**。

注：工作树里还混有**此前已存在、非本次**的 Integration 需求集成看板 UI 改动(`Integration/index.tsx` 等)，提交时注意剥离。
