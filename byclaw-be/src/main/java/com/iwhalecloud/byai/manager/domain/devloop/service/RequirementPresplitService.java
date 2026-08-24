package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.feign.response.knowledge.ModelDto;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AIService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiModelService;
import com.iwhalecloud.byai.manager.domain.aimodel.service.AiPromptService;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitResultDto;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitResultDto.PresplitTask;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import lombok.extern.slf4j.Slf4j;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Iterator;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Set;

/**
 * 需求 AI 预拆:把需求内容 + 项目仓库清单交给大模型,产出每仓库一条的子任务草稿与仓库间依赖。
 *
 * <p>纯读 + 一次模型调用,不落库。用户在弹窗里改完再点启动,由 devloop 的 /task/split 批量入口一次性建会话。
 * 提示词从 byai_ai_prompt 按 {@link #PROMPT_CODE} 取,运营可改;表里没有记录时用内置模板兜底,保证功能不因未初始化而不可用。</p>
 */
@Slf4j
@Service
public class RequirementPresplitService {

    /** byai_ai_prompt.prompt_code,运营在提示词管理里维护这条模板。 */
    public static final String PROMPT_CODE = "DEVLOOP_REQUIREMENT_PRESPLIT_PROMPT";

    /** 预拆输出是结构化 JSON 而非长文,给足余量即可;仓库多时主要涨在 reason 上。 */
    private static final int MAX_TOKENS = 2_000;

    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    /** 表里无模板时的兜底系统提示词,与 byai_ai_prompt 里的初始化内容保持一致。 */
    private static final String FALLBACK_PROMPT_ZH = """
        你是研发拆单助手。输入是一条需求和该项目下的代码仓库清单,请把需求拆成可并行或串行执行的仓库级子任务。

        规则:
        1. 只能使用输入中给出的 repoId,不得编造;与需求无关的仓库不要产出任务。
        2. 一个仓库最多一条任务。需求只涉及一个仓库时就只产出一条。
        3. dependsOn 用同批任务的 rowId 表示上游依赖,必须无环;能并行的不要硬串成链。
        4. title 用中文描述该仓库要做的具体改动,不要照抄需求标题。
        5. branch 全批任务保持一致:输入里给了「工作区分支」时必须原样用它,没给时才用 feat/<英文小写短横线短语>。
        6. reason 一句话说明为什么这个仓库要改、为什么有/没有这个依赖。

        只输出 JSON,结构为:
        {"tasks":[{"rowId":"row-0","repoId":123,"title":"...","branch":"feat/xxx","dependsOn":[],"reason":"..."}]}
        """;

    @Autowired
    private AiPromptService aiPromptService;

    @Autowired
    private AiModelService aiModelService;

    @Autowired
    private AIService aiService;

    /**
     * 产出预拆草稿。任何失败都不抛,降级为「每仓库一行 + 不猜依赖 + aiSuggested=false」,
     * 让用户仍能手工编辑后启动 —— 预拆是辅助,不该成为启动流程的硬依赖。
     *
     * <p>方法名以 get 开头是有意的:命中 TransactionAdviceConfig 的读通配符,预拆期间不持有事务,
     * 否则会落到 {@code *} → REQUIRED,整个模型调用时长都占着一条数据库连接。</p>
     *
     * @param title 需求标题
     * @param content 需求正文,可空
     * @param repos 该项目的仓库清单,预拆结果的 repoId 只能取自这里
     * @param language 请求语言,"en" 取英文模板,其余取中文
     */
    public RequirementPresplitResultDto getPresplitDraft(String title, String content, List<ProjectRepo> repos,
        String language) {
        if (repos == null || repos.isEmpty()) {
            return degrade(repos, title, "no_repo");
        }
        ModelDto model = aiModelService.getDefaultChatModel();
        if (model == null) {
            return degrade(repos, title, "no_default_model");
        }
        try {
            String systemPrompt = StringUtils.defaultIfBlank(
                aiPromptService.findTemplateByCode(PROMPT_CODE, language), FALLBACK_PROMPT_ZH);
            String json = aiService.generateJsonObject(systemPrompt, buildUserPrompt(title, content, repos), model,
                MAX_TOKENS);
            if (StringUtils.isBlank(json)) {
                return degrade(repos, title, "empty_model_output");
            }
            List<PresplitTask> tasks = parseTasks(json, repos, title);
            if (tasks.isEmpty()) {
                return degrade(repos, title, "unparseable_model_output");
            }
            RequirementPresplitResultDto result = new RequirementPresplitResultDto();
            result.setAiSuggested(true);
            result.setTasks(tasks);
            return result;
        }
        catch (Exception e) {
            // 模型不可用/超时/限流都不该挡住启动流程,记日志后降级。
            log.warn("需求 AI 预拆失败,降级为每仓库一行: title={}", title, e);
            return degrade(repos, title, "model_call_failed");
        }
    }

    /**
     * 用户提示词:需求正文 + 仓库清单(repoId/全名/默认分支/描述/类型),模型只能在这些 repoId 里选。
     * 工作区分支单独列一段:它是这批任务应该落的分支,不能让模型只从各仓库 defaultBranch 里挑。
     */
    private String buildUserPrompt(String title, String content, List<ProjectRepo> repos) {
        StringBuilder sb = new StringBuilder();
        sb.append("# 需求标题\n").append(StringUtils.defaultString(title)).append('\n');
        if (StringUtils.isNotBlank(content)) {
            sb.append("\n# 需求内容\n").append(content).append('\n');
        }
        String workspaceBranch = findWorkspaceBranch(repos);
        if (workspaceBranch != null) {
            sb.append("\n# 工作区分支\n").append(workspaceBranch).append("\n(全部任务的 branch 必须用这个值)\n");
        }
        sb.append("\n# 可选代码仓库\n");
        for (ProjectRepo repo : repos) {
            sb.append("- repoId=").append(repo.getRepoId())
                .append(" name=").append(StringUtils.defaultIfBlank(repo.getRepoFullName(), repo.getRepoUrl()));
            if (StringUtils.isNotBlank(repo.getDefaultBranch())) {
                sb.append(" defaultBranch=").append(repo.getDefaultBranch());
            }
            if (StringUtils.isNotBlank(repo.getRepoType())) {
                sb.append(" type=").append(repo.getRepoType());
            }
            // 描述是人工填的仓库职责,模型判断「该改哪些仓库」主要靠它;换行压平避免破坏一行一仓库的结构。
            if (StringUtils.isNotBlank(repo.getDescription())) {
                sb.append(" description=").append(repo.getDescription().replace('\n', ' '));
            }
            sb.append('\n');
        }
        return sb.toString();
    }

    /**
     * 工作区分支 = repoType=workspace 那条仓库的 defaultBranch。工作区仓库携带项目上下文,
     * 这批子任务应该跟着它走,而不是各代码仓库自己的默认分支或模型编的 feat/xxx。
     * 没有工作区仓库(或它没配分支)时返回 null,由调用方回退到按标题生成分支名。
     */
    static String findWorkspaceBranch(List<ProjectRepo> repos) {
        if (repos == null) {
            return null;
        }
        for (ProjectRepo repo : repos) {
            if ("workspace".equals(repo.getRepoType())) {
                return StringUtils.trimToNull(repo.getDefaultBranch());
            }
        }
        return null;
    }

    /**
     * 解析模型 JSON。模型输出不可信:未知 repoId、重复仓库、悬空/自环依赖一律丢弃,
     * 保证返回的草稿一定能通过 /task/split 的校验,不会让用户点了启动才失败。
     */
    static List<PresplitTask> parseTasks(String json, List<ProjectRepo> repos, String requirementTitle)
        throws Exception {
        Set<Long> allowedRepoIds = new LinkedHashSet<>();
        for (ProjectRepo repo : repos) {
            allowedRepoIds.add(repo.getRepoId());
        }
        JsonNode root = OBJECT_MAPPER.readTree(json);
        JsonNode array = root.path("tasks");
        if (!array.isArray()) {
            return List.of();
        }
        // 工作区分支优先于模型输出:提示词已经告知,但「优先取」是确定性规则,不能只靠模型遵守。
        String workspaceBranch = findWorkspaceBranch(repos);
        String fallbackBranch = workspaceBranch != null ? workspaceBranch : suggestBranch(requirementTitle);
        // 模型给的 rowId 可能重复或缺失,重编成 row-0..row-N 并保留原引用映射,依赖翻译才对得上。
        Map<String, PresplitTask> byOriginalRowId = new LinkedHashMap<>();
        Set<Long> usedRepoIds = new LinkedHashSet<>();
        List<String> rawDeps = new ArrayList<>();
        int index = 0;
        for (Iterator<JsonNode> it = array.elements(); it.hasNext(); ) {
            JsonNode node = it.next();
            Long repoId = node.path("repoId").isNumber() ? node.path("repoId").asLong() : null;
            if (repoId == null || !allowedRepoIds.contains(repoId) || !usedRepoIds.add(repoId)) {
                continue;
            }
            PresplitTask task = new PresplitTask();
            task.setRowId("row-" + index);
            task.setRepoId(repoId);
            task.setTitle(StringUtils.defaultIfBlank(node.path("title").asText(null), requirementTitle));
            task.setBranch(StringUtils.defaultIfBlank(node.path("branch").asText(null), fallbackBranch));
            task.setReason(StringUtils.trimToNull(node.path("reason").asText(null)));
            task.setDependsOn(new ArrayList<>());
            String originalRowId = StringUtils.defaultIfBlank(node.path("rowId").asText(null), task.getRowId());
            byOriginalRowId.putIfAbsent(originalRowId, task);
            rawDeps.add(joinDeps(node.path("dependsOn")));
            index++;
        }
        List<PresplitTask> tasks = new ArrayList<>(byOriginalRowId.values());
        if (tasks.isEmpty()) {
            return List.of();
        }
        // 有工作区分支就强制覆盖模型输出;没有才全批取第一条,避免各子任务落到不同分支上。
        String branch = workspaceBranch != null ? workspaceBranch : tasks.get(0).getBranch();
        for (PresplitTask task : tasks) {
            task.setBranch(branch);
        }
        applyDeps(tasks, rawDeps, byOriginalRowId);
        return tasks;
    }

    private static String joinDeps(JsonNode depsNode) {
        if (!depsNode.isArray()) {
            return "";
        }
        List<String> deps = new ArrayList<>();
        for (Iterator<JsonNode> it = depsNode.elements(); it.hasNext(); ) {
            String dep = StringUtils.trimToNull(it.next().asText(null));
            if (dep != null) {
                deps.add(dep);
            }
        }
        return String.join(",", deps);
    }

    /** 依赖翻译:原始 rowId → 重编后的 rowId;丢掉自环与引用不到的,再逐条剔除会成环的边。 */
    private static void applyDeps(List<PresplitTask> tasks, List<String> rawDeps, Map<String, PresplitTask> byOriginalRowId) {
        for (int i = 0; i < tasks.size() && i < rawDeps.size(); i++) {
            PresplitTask task = tasks.get(i);
            if (StringUtils.isBlank(rawDeps.get(i))) {
                continue;
            }
            for (String dep : rawDeps.get(i).split(",")) {
                PresplitTask upstream = byOriginalRowId.get(dep.trim());
                if (upstream == null || upstream == task || task.getDependsOn().contains(upstream.getRowId())) {
                    continue;
                }
                task.getDependsOn().add(upstream.getRowId());
                if (hasCycle(tasks)) {
                    // 成环的依赖图会让下游按序执行永远等不到上游,宁可少一条边也不能留环。
                    task.getDependsOn().remove(upstream.getRowId());
                }
            }
        }
    }

    /** Kahn 消点:能全部消完说明无环。 */
    private static boolean hasCycle(List<PresplitTask> tasks) {
        Map<String, Integer> indegree = new LinkedHashMap<>();
        for (PresplitTask task : tasks) {
            indegree.put(task.getRowId(), task.getDependsOn().size());
        }
        int removed = 0;
        boolean progressed = true;
        while (progressed) {
            progressed = false;
            for (PresplitTask task : tasks) {
                if (indegree.get(task.getRowId()) != 0) {
                    continue;
                }
                indegree.put(task.getRowId(), -1);
                removed++;
                progressed = true;
                for (PresplitTask other : tasks) {
                    if (other.getDependsOn().contains(task.getRowId()) && indegree.get(other.getRowId()) > 0) {
                        indegree.put(other.getRowId(), indegree.get(other.getRowId()) - 1);
                    }
                }
            }
        }
        return removed < tasks.size();
    }

    /**
     * 降级:每个仓库一行,不猜依赖、不猜标题分工,aiSuggested=false —— 不能把兜底冒充成模型结果。
     * 仓库为空时给一条无仓库的空行,由用户在弹窗里自己选仓库。
     */
    private RequirementPresplitResultDto degrade(List<ProjectRepo> repos, String title, String reason) {
        // 降级也要遵守工作区分支优先,否则模型不可用时前端会显示一个和工作区不一致的分支。
        String workspaceBranch = findWorkspaceBranch(repos);
        String branch = workspaceBranch != null ? workspaceBranch : suggestBranch(title);
        List<PresplitTask> tasks = new ArrayList<>();
        if (repos == null || repos.isEmpty()) {
            PresplitTask task = new PresplitTask();
            task.setRowId("row-0");
            task.setTitle(title);
            task.setBranch(branch);
            task.setDependsOn(new ArrayList<>());
            tasks.add(task);
        }
        else {
            int index = 0;
            for (ProjectRepo repo : repos) {
                PresplitTask task = new PresplitTask();
                task.setRowId("row-" + index++);
                task.setRepoId(repo.getRepoId());
                task.setTitle(title);
                task.setBranch(branch);
                task.setDependsOn(new ArrayList<>());
                tasks.add(task);
            }
        }
        RequirementPresplitResultDto result = new RequirementPresplitResultDto();
        result.setAiSuggested(false);
        result.setDegradeReason(reason);
        result.setTasks(tasks);
        return result;
    }

    /** 兜底分支名:标题里的 ASCII 词转短横线短语,没有可用字符时回退 feat/req。 */
    private static String suggestBranch(String title) {
        String slug = StringUtils.defaultString(title).toLowerCase(Locale.ROOT)
            .replaceAll("[^a-z0-9]+", "-")
            .replaceAll("(^-+)|(-+$)", "");
        if (slug.length() > 32) {
            slug = slug.substring(0, 32).replaceAll("-+$", "");
        }
        return StringUtils.isBlank(slug) ? "feat/req" : "feat/" + slug;
    }
}
