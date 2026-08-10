package com.iwhalecloud.byai.manager.application.service.devloop;

import java.io.ByteArrayOutputStream;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiPromptService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DefaultAgentService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.entity.devloop.DefaultAgent;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.service.AssistantChatService;

/**
 * 研发项目工作区初始化：下发架构数字员工，在沙箱内完成克隆/骨架/技能包/推送，平台只轮询状态。
 *
 * <p>初始化动作全部由架构助理在沙箱里做，后端不再自己 clone/装技能包/push：那条 Java 流程要在服务端持有仓库凭据与工作副本，
 * 而员工侧本来就有沙箱与令牌，同一件事做两遍只会让两边行为漂移。
 *
 * <p>完成信号取 self-developed-rules 契约的会话状态文件（{@code /by/.acp-runs/sessions/<会话ID>.json}），与研发助理 coder
 * 判完成用的是同一个文件、同一个 {@code status == completed} 口径，不另立一套回调接口——回调需要员工侧主动调平台，比写文件脆。
 */
@Service
public class WorkspaceInitService {

    private static final Logger log = LoggerFactory.getLogger(WorkspaceInitService.class);

    /** 项目初始化状态机：pending 待初始化 → initializing 初始化中 → ready 已就绪；失败/超时退回 pending 让用户可重发。 */
    static final String INIT_STATUS_PENDING = "pending";

    static final String INIT_STATUS_INITIALIZING = "initializing";

    static final String INIT_STATUS_READY = "ready";

    /** 研发项目才需要工作区初始化；普通项目建完即 ready。 */
    private static final String PROJECT_TYPE_DEVELOP = "develop";

    /** 工作区仓库类型：一个研发项目只有一个 workspace 仓库，初始化就是初始化它。 */
    private static final String REPO_TYPE_WORKSPACE = "workspace";

    /** 任务状态文件里的完成态，与 coder 任务共用同一口径。 */
    private static final String TASK_STATUS_COMPLETED = "completed";

    /**
     * 初始化超时上限。架构助理要 clone、读仓库、生成骨架、装技能包、push，比一次集成测试重，给到 2 小时； 超时退回 pending 而不是停在 initializing，否则项目永久禁用建需求/启动任务。
     */
    private static final long INIT_TIMEOUT_MS = 2L * 60 * 60 * 1000;

    /** chat 全程流式，不能占住定时任务线程或 HTTP 线程；单独小池下发即可，下发失败只影响本次初始化。 */
    private static final ExecutorService INIT_CHAT_EXECUTOR = Executors.newFixedThreadPool(2, runnable -> {
        Thread thread = new Thread(runnable, "workspace-init-chat");
        thread.setDaemon(true);
        return thread;
    });

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ByaiSessionMapper byaiSessionMapper;

    @Autowired
    private DefaultAgentService defaultAgentService;

    @Autowired
    private AssistantChatService assistantChatService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private AiPromptService aiPromptService;

    @Autowired
    private DevloopTaskStateReader taskStateReader;

    /**
     * 触发工作区初始化：解析架构助理 → 建会话 → 拼提示词 → 置 initializing 并冻结会话ID → 异步下发。
     *
     * <p>幂等由「重发即覆盖」保证：initializing 态再次调用会换成新会话，用于员工卡死时人工重试；旧会话的状态文件不再被读。
     *
     * @param projectId 研发项目ID
     * @param buildIndex 是否建代码索引
     * @param skillPackages 建索引所需技能包，前端传数组，落库前拼成逗号分隔
     * @return 本次初始化的会话ID
     */
    public Long startWorkspaceInit(Long projectId, boolean buildIndex, Object skillPackages) {
        Project project = requireProject(projectId);
        if (!PROJECT_TYPE_DEVELOP.equals(project.getProjectType())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.init.developOnly");
        }
        ProjectRepo workspaceRepo = findWorkspaceRepo(projectId);
        if (workspaceRepo == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.init.workspaceRepoRequired");
        }
        Long architectAgentId = resolveArchitectAgentId(projectId);
        if (architectAgentId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.init.architectRequired");
        }
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.init.loginRequired");
        }

        // 先用可读标题建会话拿 sessionId：提示词里的沙箱路径与状态文件路径都要它，只能建完再拼。
        AssistantChatDto chatDto = new AssistantChatDto();
        chatDto.setSessionId(null);
        chatDto.setAgentId(architectAgentId);
        chatDto.setProjectId(projectId);
        chatDto.setChatContent("工作区初始化 - " + StringUtils.defaultString(project.getProjectName()));
        chatDto.setAccessTerminal("DevLoop");
        chatDto.setClientRequestId(AssistantChatService.getClientRequestId());
        assistantChatService.createGroupChatSession(chatDto);
        Long sessionId = chatDto.getSessionId();
        chatDto.setChatContent(buildInitPrompt(project, workspaceRepo, sessionId, buildIndex, skillPackages));

        Project update = new Project();
        update.setProjectId(projectId);
        update.setInitStatus(INIT_STATUS_INITIALIZING);
        update.setInitSessionId(sessionId);
        update.setBuildIndex(buildIndex ? Constants.YES_VALUE_Y : Constants.NO_VALUE_N);
        // 技能包仅建索引时保留；updateById 跳过 null，故清空要写空串而不是 null。
        update.setIndexSkills(buildIndex ? joinSkillPackages(skillPackages) : "");
        update.setInitFailReason("");
        update.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        update.setUpdateTime(new Date());
        projectService.update(update);

        // 会话已由 createGroupChatSession 落库，异步线程读得到；chat 流式耗时长，不能占住本请求。
        INIT_CHAT_EXECUTOR.execute(() -> {
            try {
                assistantChatService.chat(chatDto, new ByteArrayOutputStream(), loginInfo);
            }
            catch (Exception e) {
                log.error("[WorkspaceInit] 下发架构员工 chat 失败, projectId={}, sessionId={}", projectId, sessionId, e);
            }
        });
        log.info("[WorkspaceInit] 已下发架构员工初始化, projectId={}, sessionId={}, architectAgentId={}", projectId, sessionId,
            architectAgentId);
        return sessionId;
    }

    /**
     * 轮询所有 initializing 项目：状态文件报完成置 ready，超时退回 pending 并记原因，其余留待下轮。
     *
     * <p>只查 develop + initializing + 有会话ID 的项目，量级等于「正在初始化的研发项目数」，通常个位数；每个项目一次定点文件读。
     */
    public void sweepInitializingProjects() {
        List<Project> initializing = projectMapper.selectList(new LambdaQueryWrapper<Project>()
            .eq(Project::getProjectType, PROJECT_TYPE_DEVELOP)
            .eq(Project::getInitStatus, INIT_STATUS_INITIALIZING)
            .isNotNull(Project::getInitSessionId)
            .eq(Project::getDeleteFlag, DeleteFlag.NORMAL));
        for (Project project : initializing) {
            try {
                recoverInitResult(project);
            }
            catch (Exception e) {
                log.error("[WorkspaceInit] 回收初始化状态异常, projectId={}, sessionId={}", project.getProjectId(),
                    project.getInitSessionId(), e);
            }
        }
    }

    /** 单个项目的状态回收：completed 置 ready；文件缺失/未完成时只在超时后退回 pending，避免误判员工还在干活。 */
    private void recoverInitResult(Project project) {
        DevloopTaskStateDto state = readInitState(project.getInitSessionId());
        if (state != null && TASK_STATUS_COMPLETED.equals(state.getStatus())) {
            applyInitResult(project, INIT_STATUS_READY, "");
            return;
        }
        // 状态文件缺失是正常态（员工还没写第一笔），不能据此判失败；只有超时才收口。
        Date updateTime = project.getUpdateTime();
        long startedMs = updateTime != null ? updateTime.getTime() : System.currentTimeMillis();
        if (System.currentTimeMillis() - startedMs >= INIT_TIMEOUT_MS) {
            applyInitResult(project, INIT_STATUS_PENDING, "架构数字员工初始化超时未完成，请重新发起初始化");
        }
    }

    /** 落初始化终态。退回 pending 时清掉会话ID：那条会话已判超时，下轮不该再被读。 */
    private void applyInitResult(Project project, String initStatus, String failReason) {
        Project update = new Project();
        update.setProjectId(project.getProjectId());
        update.setInitStatus(initStatus);
        update.setInitFailReason(failReason);
        if (INIT_STATUS_PENDING.equals(initStatus)) {
            // updateById 跳过 null，清列只能靠 0；0 与真实会话ID不冲突（会话ID取自序列，恒 > 0）。
            update.setInitSessionId(0L);
        }
        update.setUpdateTime(new Date());
        projectService.update(update);
        log.info("[WorkspaceInit] 初始化状态收口, projectId={}, initStatus={}, reason={}", project.getProjectId(), initStatus,
            failReason);
    }

    /** 读会话状态文件。UserFS 按用户隔离，故要先由会话创建人解析出 userCode，与 coder 任务读投影同一路径。 */
    private DevloopTaskStateDto readInitState(Long sessionId) {
        ByaiSession session = byaiSessionMapper.selectById(sessionId);
        if (session == null || session.getCreatorId() == null) {
            log.warn("[WorkspaceInit] 初始化会话不存在或缺少创建者, sessionId={}", sessionId);
            return null;
        }
        LoginInfo owner = loginApplicationService.getLoginInfo(session.getCreatorId());
        if (owner == null || StringUtils.isBlank(owner.getUserCode())) {
            log.warn("[WorkspaceInit] 无法解析初始化会话创建者, sessionId={}", sessionId);
            return null;
        }
        return taskStateReader.read(owner.getUserCode(), sessionId);
    }

    /** 架构助理来自项目默认员工（项目覆盖优先，回退全局）；字符串存储，空或非法都按未配置处理。 */
    private Long resolveArchitectAgentId(Long projectId) {
        DefaultAgent agent = defaultAgentService.resolveForProject(projectId);
        String raw = agent == null ? null : agent.getArchitectAgentId();
        if (StringUtils.isBlank(raw)) {
            return null;
        }
        try {
            return Long.valueOf(raw.trim());
        }
        catch (NumberFormatException e) {
            log.warn("[WorkspaceInit] 架构员工ID非法, projectId={}, raw={}", projectId, StringUtils.abbreviate(raw, 40));
            return null;
        }
    }

    /** 一个研发项目只有一个 workspace 仓库；多条时取最早建的，保证重发初始化指向同一个仓库。 */
    private ProjectRepo findWorkspaceRepo(Long projectId) {
        List<ProjectRepo> repos = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getProjectId, projectId)
            .eq(ProjectRepo::getRepoType, REPO_TYPE_WORKSPACE)
            .orderByAsc(ProjectRepo::getRepoId));
        return repos.isEmpty() ? null : repos.get(0);
    }

    /**
     * 拼初始化提示词：模板取自 byai_ai_prompt（可运营），缺失时用内置兜底，保证初始化永远可下发。 克隆说明复用研发任务那份平台/令牌约定，避免两处各写一套 clone 指令。
     */
    private String buildInitPrompt(Project project, ProjectRepo repo, Long sessionId, boolean buildIndex,
        Object skillPackages) {
        String template = aiPromptService.findTemplateByCode("DEVLOOP_WORKSPACE_INIT_PROMPT", currentLanguage());
        if (StringUtils.isBlank(template)) {
            template = DEFAULT_WORKSPACE_INIT_PROMPT_TEMPLATE;
        }
        String repoFullName = StringUtils.defaultString(repo.getRepoFullName());
        String repoUrl = StringUtils.defaultIfBlank(repo.getRepoUrl(), repoFullName);
        String defaultBranch = StringUtils.defaultIfBlank(repo.getDefaultBranch(), "main");
        return template.replace("${projectName}", StringUtils.defaultString(project.getProjectName()))
            .replace("${repoFullName}", repoFullName)
            .replace("${repoUrl}", repoUrl)
            .replace("${defaultBranch}", defaultBranch)
            .replace("${sessionId}", String.valueOf(sessionId))
            .replace("${skillPackageSection}", buildSkillPackageSection(buildIndex, skillPackages))
            .replace("${repoCloneHint}",
                DevloopApplicationService.buildRepoCloneHint(repo.getProvider(), repoUrl, repoFullName));
    }

    /**
     * 技能包段：给出每个技能包的落地动作与判重标记，与旧 ProjectInitService 的 Trellis/Superpower Initializer 等价。
     * 只报名字的话员工会自由发挥，装出来的结构跟旧实现对不上。不建索引也要占住这一步，否则模板编号断档。
     */
    private String buildSkillPackageSection(boolean buildIndex, Object skillPackages) {
        String joined = joinSkillPackages(skillPackages);
        if (!buildIndex || StringUtils.isBlank(joined)) {
            return "本项目不建代码索引，跳过技能包安装，直接进入下一步。";
        }
        StringBuilder section = new StringBuilder("安装技能包（本项目选了：").append(joined)
            .append("）。逐个按下面的方式装，已经装过的（判重标记已存在）跳过，不要重复初始化、不要覆盖已有内容：");
        for (String skill : joined.split(",")) {
            String instruction = SKILL_PACKAGE_INSTRUCTIONS.get(skill.toLowerCase());
            section.append("\n   - ").append(skill).append("：")
                .append(instruction != null ? instruction
                    : "仓库里没有该技能包的既定装法，先查它的官方文档再装；装不了就把原因写进任务状态并转 paused，不要跳过不报。");
        }
        return section.toString();
    }

    /**
     * 各技能包的安装动作：照搬旧 TrellisInitializer / SuperpowerInitializer 的命令与产物，含判重标记。
     * key 用小写，前端传的是 trellis / superpowers。
     */
    private static final Map<String, String> SKILL_PACKAGE_INSTRUCTIONS = Map.of(
        "trellis",
        "在仓库根目录执行 `trellis init --claude --monorepo -y -f`（非交互），产出 .trellis/ 骨架"
            + "（workflow.md、config.yaml、tasks/、workspace/、spec/）。判重标记：.trellis/ 已存在。"
            + "trellis 命令不可用时不要手搓目录，把缺 CLI 的情况写进任务状态并转 paused。",
        "superpowers",
        "建 .agents/skills/ 目录（放 README.md 说明技能目录结构，加 .gitkeep 让空目录能进 Git），"
            + "并建 .claude/settings.json 配好 permissions.allow 与 context.alwaysInclude（至少含 .agents/**/*.md 与 CLAUDE.md）。"
            + "判重标记：.agents/skills/ 已存在。");

    /**
     * 提示词兜底：DB 未配置 DEVLOOP_WORKSPACE_INIT_PROMPT 时使用，与 V0.4.0 DML 中的模板保持一致。
     * 步骤照搬旧 ProjectInitService 实际做的四件事：克隆 -> 装技能包 -> commit -> push，不要另加骨架生成之类它没做的事。
     */
    private static final String DEFAULT_WORKSPACE_INIT_PROMPT_TEMPLATE = """
        请初始化本研发项目的工作区仓库。

        ## 项目信息
        - 项目：${projectName}
        - 工作区仓库：${repoFullName}
        - 仓库地址：${repoUrl}
        - 默认分支：${defaultBranch}
        - 会话ID：${sessionId}

        ## 仓库访问说明
        ${repoCloneHint}

        ## 初始化步骤
        1. 把工作区仓库克隆到 /by/.sessions/${sessionId}/{仓库名}/，检出默认分支 ${defaultBranch}。
           克隆完确认 .git 存在，是个正常的 Git 仓库。
        2. 看一眼仓库现状，判断哪些技能包已经装过。不要覆盖用户已有内容。
        3. ${skillPackageSection}
        4. 有变更就在默认分支 ${defaultBranch} 上提交，提交信息用
           `chore: init <技能包名，逗号分隔> skill package(s)`；没装任何技能包时用 `chore: update repository`。
           工作区没有任何变更就跳过提交，不要造空提交。
        5. 有新提交才 push 到远端 ${defaultBranch}；没有新提交不要 push。

        ## 边界
        - 本次只做上面五步。不要顺手改业务代码、不要生成架构文档或 checklist、不要建仓库里原本没有的目录。
        - push 被拒或没有仓库权限时不要绕路（不要改远端地址、不要 force push），按下面的要求转 paused 报出来。

        ## 强制要求
        - 启动时必须先调用 skill：self-developed-rules，并按其 JSON 状态契约初始化 trace。
        - 全过程的进展必须打到 /by/.acp-runs/sessions/${sessionId}.json：平台只读这个文件判断初始化是否完成，
          不写这个文件，项目会一直卡在「初始化中」，用户无法新建需求或启动任务。
        - 五步全部做完（该 push 的已 push）才把任务状态收为 completed；中途遇到不可恢复的问题
          （无仓库权限、push 被拒、技能包 CLI 缺失等）按契约转 paused 并写清原因，不要静默结束。""";

    /** 提示词语言取当前请求上下文；异步/定时无上下文时回退中文，与研发任务提示词同一口径。 */
    private String currentLanguage() {
        try {
            if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
                Object language = attributes.getRequest().getAttribute(I18nUtil.LANGUAGE);
                if (language != null && StringUtils.isNotBlank(String.valueOf(language))) {
                    return String.valueOf(language);
                }
            }
        }
        catch (Exception ignored) {
            // 请求上下文在异步线程中可能不存在，按默认中文处理。
        }
        return I18nUtil.CHINSES;
    }

    private Project requireProject(Long projectId) {
        if (projectId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.id.required");
        }
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "project.not.found");
        }
        return project;
    }

    /** 技能包来自 HTTP Map 入参，类型不可信；非数组或空元素一律按未选处理，落库统一逗号分隔。 */
    private String joinSkillPackages(Object raw) {
        if (!(raw instanceof List<?> list) || list.isEmpty()) {
            return "";
        }
        return list.stream().filter(Objects::nonNull).map(Object::toString).map(String::trim)
            .filter(item -> !item.isEmpty()).collect(Collectors.joining(","));
    }
}
