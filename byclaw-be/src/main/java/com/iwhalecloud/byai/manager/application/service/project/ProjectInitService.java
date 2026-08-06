package com.iwhalecloud.byai.manager.application.service.project;

import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import java.time.LocalDateTime;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.config.GitWorkspaceConfig;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.project.service.GitCommandExecutor;
import com.iwhalecloud.byai.manager.domain.project.service.ProjectInitAuditService;
import com.iwhalecloud.byai.manager.domain.project.service.ProjectInitTaskManager;
import com.iwhalecloud.byai.manager.domain.project.service.RepoLockManager;
import com.iwhalecloud.byai.manager.domain.project.service.SuperpowerInitializer;
import com.iwhalecloud.byai.manager.domain.project.service.TrellisInitializer;
import com.iwhalecloud.byai.manager.dto.project.ProjectInitRequest;
import com.iwhalecloud.byai.manager.dto.project.ProjectInitResponse;
import com.iwhalecloud.byai.manager.dto.project.SubmoduleInfo;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import jakarta.servlet.http.HttpServletRequest;
import lombok.extern.slf4j.Slf4j;

/**
 * 项目初始化应用服务
 *
 * 编排集成项目的 Git 仓库初始化流程
 * 支持同步和异步两种执行模式
 */
@Slf4j
@Service
public class ProjectInitService {

    @Autowired
    private GitWorkspaceConfig gitWorkspaceConfig;

    @Autowired
    private GitCommandExecutor gitCommandExecutor;

    @Autowired
    private RepoLockManager repoLockManager;

    @Autowired
    private TrellisInitializer trellisInitializer;

    @Autowired
    private SuperpowerInitializer superpowerInitializer;

    @Autowired
    private ProjectInitAuditService auditService;

    @Autowired
    private ProjectInitTaskManager taskManager;

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    /**
     * 同步初始化（原有方法，保持向后兼容）
     *
     * @param request 初始化请求
     * @return 初始化结果
     * @throws BaseException 如果初始化失败
     */
    public ProjectInitResponse initProject(ProjectInitRequest request) throws BaseException {
        String requestId = UUID.randomUUID().toString();
        String userId = getCurrentUserId();
        String username = getCurrentUsername();
        String ipAddress = getClientIpAddress();
        LocalDateTime startTime = LocalDateTime.now();
        long startMillis = System.currentTimeMillis();

        try {
            ProjectInitResponse response = executeInitialization(request);

            // 记录审计日志成功
            LocalDateTime endTime = LocalDateTime.now();
            long durationMs = System.currentTimeMillis() - startMillis;
            auditService.logSuccess(requestId, request, response, userId, username, ipAddress,
                startTime, endTime, durationMs);

            return response;

        } catch (Exception e) {
            // 记录审计日志失败
            LocalDateTime endTime = LocalDateTime.now();
            long durationMs = System.currentTimeMillis() - startMillis;
            auditService.logFailure(requestId, request, userId, username, ipAddress,
                startTime, endTime, durationMs, e.getMessage());

            throw e;
        }
    }

    /**
     * 异步初始化（新增方法）
     *
     * @param request 初始化请求
     * @return 任务ID（用于查询任务状态）
     */
    public String initProjectAsync(ProjectInitRequest request) {
        String requestId = UUID.randomUUID().toString();
        String userId = getCurrentUserId();
        String username = getCurrentUsername();
        String ipAddress = getClientIpAddress();

        // 创建异步任务
        String taskId = taskManager.createTask(userId, requestId,
            "project_" + request.getProjectId(), request.getSkillPackageName());

        // 异步执行初始化（审计日志将在任务结束时记录）
        executeInitializationAsync(taskId, requestId, request, userId, username, ipAddress);

        return taskId;
    }

    /**
     * 异步执行初始化（在独立线程中运行）
     */
    @Async("projectInitExecutor")
    public void executeInitializationAsync(String taskId, String requestId, ProjectInitRequest request,
                                          String userId, String username, String ipAddress) {
        LocalDateTime startTime = LocalDateTime.now();
        long startMillis = System.currentTimeMillis();

        try {
            // 更新任务状态：开始执行
            taskManager.updateTaskStatus(taskId, "RUNNING", "Validating path", 10);

            // 执行初始化
            ProjectInitResponse response = executeInitialization(request);

            // 更新任务状态：成功
            taskManager.updateTaskResult(taskId, response);

            // 记录审计日志成功
            LocalDateTime endTime = LocalDateTime.now();
            long durationMs = System.currentTimeMillis() - startMillis;
            auditService.logSuccess(requestId, request, response, userId, username, ipAddress,
                startTime, endTime, durationMs);

            log.info("Async project initialization completed: taskId={}, projectId={}",
                taskId, request.getProjectId());

        } catch (Exception e) {
            // 更新任务状态：失败
            taskManager.updateTaskError(taskId, e.getMessage());

            // 记录审计日志失败
            LocalDateTime endTime = LocalDateTime.now();
            long durationMs = System.currentTimeMillis() - startMillis;
            auditService.logFailure(requestId, request, userId, username, ipAddress,
                startTime, endTime, durationMs, e.getMessage());

            log.error("Async project initialization failed: taskId={}, projectId={}",
                taskId, request.getProjectId(), e);
        }
    }

    /**
     * 核心初始化逻辑（同步和异步共用）
     */
    private ProjectInitResponse executeInitialization(ProjectInitRequest request) throws BaseException {
        // 1. 查询项目
        Project project = projectService.findById(request.getProjectId());
        if (project == null) {
            throw new BaseException(50404, "Project not found: " + request.getProjectId());
        }

        // 2. 查询 workspace 类型仓库
        ProjectRepo repo = findWorkspaceRepo(request.getProjectId());
        if (repo == null) {
            throw new BaseException(50404,
                "No workspace repository configured for project: " + project.getProjectName());
        }

        // 3. 构建本地仓库路径
        Path repoPath = buildRepoPath(repo);
        String normalizedPath = repoPath.toString();

        log.info("Starting project initialization: projectId={}, provider={}, repoFullName={}, repoUrl={}, path={}, skillPackage={}, submodules={}",
            request.getProjectId(), repo.getProvider(), repo.getRepoFullName(), repo.getRepoUrl(),
            normalizedPath, request.getSkillPackageName(),
            request.getSubmodules() != null ? request.getSubmodules().size() : 0);

        // 4. 验证仓库已克隆到本地，如果不存在则自动克隆
        if (!Files.exists(repoPath)) {
            log.warn("Repository not found locally: {}. Attempting to clone from: {}",
                normalizedPath, repo.getRepoUrl());

            try {
                // 自动克隆仓库
                String branch = request.getRepoBranch() != null && !request.getRepoBranch().isBlank()
                    ? request.getRepoBranch()
                    : repo.getDefaultBranch();

                gitCommandExecutor.cloneRepository(repo.getRepoUrl(), repoPath, branch);

                log.info("Successfully cloned repository to: {}", normalizedPath);
            } catch (BaseException e) {
                throw new BaseException(50500,
                    "Failed to clone repository: " + repo.getRepoUrl() +
                    ". Error: " + e.getMessage(), e);
            }
        }

        if (!gitCommandExecutor.isGitRepository(repoPath)) {
            throw new BaseException(50400,
                "Path is not a Git repository (missing .git directory): " + normalizedPath);
        }

        // 5. 获取锁（非阻塞）
        if (!repoLockManager.acquireLock(normalizedPath)) {
            throw new BaseException(50409,
                "Repository is currently being initialized by another process: " + normalizedPath);
        }

        try {
            // 6. 更新项目状态为 initializing（仅研发项目）
            if ("develop".equals(project.getProjectType())) {
                try {
                    Project projectUpdate = new Project();
                    projectUpdate.setProjectId(project.getProjectId());
                    projectUpdate.setInitStatus("initializing");
                    projectUpdate.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    projectUpdate.setUpdateTime(new java.util.Date());
                    projectService.update(projectUpdate);
                    log.info("Project init_status updated to 'initializing': projectId={}", request.getProjectId());
                } catch (Exception e) {
                    log.error("Failed to update project init_status to 'initializing': projectId={}",
                        request.getProjectId(), e);
                    // 继续执行，状态更新失败不影响初始化流程
                }
            }

            // 7. 检查技能包是否已初始化（仅当指定了技能包时）
            if (request.getSkillPackageName() != null && !request.getSkillPackageName().isBlank()) {
                checkSkillPackageNotInitialized(repoPath, request.getSkillPackageName());
            }

            // 8. 切换分支（如果指定）
            String currentBranch = gitCommandExecutor.getCurrentBranch(repoPath);
            if (request.getRepoBranch() != null && !request.getRepoBranch().isBlank()) {
                gitCommandExecutor.checkoutBranch(repoPath, request.getRepoBranch());
                currentBranch = request.getRepoBranch();
            }

            // 9. 添加子模块（如果有）
            List<String> addedSubmodules = new ArrayList<>();
            if (request.getSubmodules() != null && !request.getSubmodules().isEmpty()) {
                for (SubmoduleInfo submodule : request.getSubmodules()) {
                    gitCommandExecutor.addSubmodule(
                        repoPath,
                        submodule.getUrl(),
                        submodule.getPath(),
                        submodule.getBranch()
                    );
                    addedSubmodules.add(submodule.getPath());
                }
            }

            // 10. 初始化技能包（仅当指定了技能包时）
            if (request.getSkillPackageName() != null && !request.getSkillPackageName().isBlank()) {
                initializeSkillPackage(repoPath, request.getSkillPackageName());
            }

            // 11. 提交变更（如果启用）
            String commitHash = null;
            boolean newCommit = false;
            if (Boolean.TRUE.equals(request.getAutoCommit())) {
                // 先获取提交前的 commit hash
                String oldCommitHash = gitCommandExecutor.getCurrentCommitHash(repoPath);

                String commitMessage = request.getCommitMessage();
                if (commitMessage == null || commitMessage.isBlank()) {
                    // 根据实际操作生成提交消息
                    if (request.getSkillPackageName() != null && !request.getSkillPackageName().isBlank()) {
                        commitMessage = String.format("chore: init %s skill package", request.getSkillPackageName());
                        if (!addedSubmodules.isEmpty()) {
                            commitMessage += " and add " + addedSubmodules.size() + " submodule(s)";
                        }
                    } else if (!addedSubmodules.isEmpty()) {
                        commitMessage = "chore: add " + addedSubmodules.size() + " submodule(s)";
                    } else {
                        commitMessage = "chore: update repository";
                    }
                }

                // 提交变更
                commitHash = gitCommandExecutor.commitAll(repoPath, commitMessage);

                // 对比提交前后的 hash，判断是否有新提交
                newCommit = !commitHash.equals(oldCommitHash);
            }

            // 11. 推送到远程（如果启用且有新提交）
            boolean pushed = false;
            if (Boolean.TRUE.equals(request.getAutoPush()) && newCommit) {
                gitCommandExecutor.push(repoPath, currentBranch);
                pushed = true;
            }

            // 12. 更新项目初始化状态为 ready
            try {
                if (project != null && "develop".equals(project.getProjectType())) {
                    Project projectUpdate = new Project();
                    projectUpdate.setProjectId(project.getProjectId());
                    projectUpdate.setInitStatus("ready");
                    projectUpdate.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    projectUpdate.setUpdateTime(new java.util.Date());
                    projectService.update(projectUpdate);
                    log.info("Project init_status updated to 'ready': projectId={}", request.getProjectId());
                }
            } catch (Exception e) {
                log.error("Failed to update project init_status to 'ready': projectId={}",
                    request.getProjectId(), e);
                // 不抛出异常，因为初始化本身已成功，只是状态更新失败
            }

            // 13. 构建成功响应
            ProjectInitResponse response = ProjectInitResponse.success(
                normalizedPath,
                currentBranch,
                request.getSkillPackageName(),
                addedSubmodules,
                commitHash,
                pushed
            );

            log.info("Project initialization completed successfully: {}", normalizedPath);
            return response;

        } catch (Exception e) {
            log.error("Project initialization failed: {}", normalizedPath, e);
            throw e;
        } finally {
            // 14. 释放锁
            repoLockManager.releaseLock(normalizedPath);
        }
    }

    /**
     * 查询项目的 workspace 类型仓库
     *
     * @param projectId 项目ID
     * @return workspace 仓库，如果不存在返回 null
     */
    private ProjectRepo findWorkspaceRepo(Long projectId) {
        LambdaQueryWrapper<ProjectRepo> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ProjectRepo::getProjectId, projectId)
               .eq(ProjectRepo::getRepoType, "workspace");
        List<ProjectRepo> repos = projectRepoMapper.selectList(wrapper);
        return repos.isEmpty() ? null : repos.get(0);
    }

    /**
     * 构建 workspace 仓库的本地路径
     *
     * 路径规则：{git.workspace.root}/project_{projectId}/{workspace_repo_name}
     * 示例：/data/git-repos/project_11038149/ByClaw-Workspace
     *
     * @param repo ProjectRepo 实体（workspace 类型仓库）
     * @return 本地仓库路径
     * @throws BaseException 如果 repoFullName 或 repoUrl 无效
     */
    private Path buildRepoPath(ProjectRepo repo) throws BaseException {
        // 1. 提取仓库名称（repoFullName 的最后一部分）
        String repoName = extractRepoName(repo);

        // 2. 构建路径：{root}/project_{projectId}/{repoName}
        Path root = Paths.get(gitWorkspaceConfig.getRoot()).toAbsolutePath().normalize();
        String projectDir = "project_" + repo.getProjectId();
        return root.resolve(projectDir).resolve(repoName).normalize();
    }

    /**
     * 从 ProjectRepo 提取仓库名称（repoFullName 的最后部分）
     *
     * 策略优先级：
     * 1. 优先使用 repoFullName（所有 provider 适用）
     *    - GitHub: wangwei721/ByClaw-Workspace → ByClaw-Workspace
     *    - GitLab: group/subgroup/project → project
     *    - 其他: owner/repo → repo
     * 2. 兜底：从 repoUrl 解析仓库名称
     *
     * 支持的 URL 格式：
     * - https://github.com/owner/repo.git → repo
     * - https://github.com/owner/repo → repo
     * - git@github.com:owner/repo.git → repo
     * - git@github.com:owner/repo → repo
     *
     * @param repo ProjectRepo 实体（从数据库查出）
     * @return 仓库名称（不含路径，如 ByClaw-Workspace）
     * @throws BaseException 如果无法提取有效名称
     */
    private String extractRepoName(ProjectRepo repo) throws BaseException {
        // 编程式校验：数据库数据不能依赖参数注解
        if (repo == null) {
            throw new BaseException(50400, "ProjectRepo is null");
        }

        String repoFullName = repo.getRepoFullName();
        String repoUrl = repo.getRepoUrl();
        String provider = repo.getProvider();

        // 校验：repoFullName 和 repoUrl 至少有一个非空
        if ((repoFullName == null || repoFullName.isBlank()) &&
            (repoUrl == null || repoUrl.isBlank())) {
            throw new BaseException(50400,
                "Both repoFullName and repoUrl are empty for projectId=" + repo.getProjectId() +
                " (provider=" + provider + ")");
        }

        // 策略1: 优先使用 repoFullName（如果非空）
        if (repoFullName != null && !repoFullName.isBlank()) {
            String cleaned = repoFullName.trim();

            // 提取最后一个斜杠后的部分（仓库名）
            // wangwei721/ByClaw-Workspace → ByClaw-Workspace
            // group/subgroup/project → project
            int lastSlash = cleaned.lastIndexOf('/');
            if (lastSlash >= 0 && lastSlash < cleaned.length() - 1) {
                String repoName = cleaned.substring(lastSlash + 1);
                log.debug("Extracted repo name from repoFullName: {} (provider={})", repoName, provider);
                return repoName;
            }

            // 如果没有斜杠，直接使用整个字符串（兼容只填项目名的情况）
            if (!cleaned.contains("/")) {
                log.debug("Using repoFullName directly as repo name: {} (provider={})", cleaned, provider);
                return cleaned;
            }

            // 格式无效（如 "/repo" 或 "owner/" 或空字符串）
            log.warn("Invalid repoFullName format: {} (expected: owner/repo or repo), fallback to URL parsing (provider={})",
                cleaned, provider);
        }

        // 策略2: repoFullName 无效或为空，从 repoUrl 解析
        if (repoUrl == null || repoUrl.isBlank()) {
            throw new BaseException(50400,
                "Repository URL is empty and repoFullName is invalid (projectId=" + repo.getProjectId() +
                ", provider=" + provider + ")");
        }

        return extractRepoNameFromUrl(repoUrl, provider);
    }

    /**
     * 从仓库 URL 解析仓库名称
     *
     * @param repoUrl 仓库 URL
     * @param provider 代码平台类型（github/gitlab/gitea，可为空）
     * @return 仓库名称（如 ByClaw-Workspace）
     * @throws BaseException 如果 URL 格式无效
     */
    private String extractRepoNameFromUrl(String repoUrl, String provider) throws BaseException {
        // 移除 .git 后缀
        String cleaned = repoUrl.trim().replaceAll("\\.git$", "");

        // HTTPS 格式: https://github.com/owner/repo → repo
        Matcher httpsMatcher = Pattern.compile("https?://[^/]+/(.+)").matcher(cleaned);
        if (httpsMatcher.find()) {
            String fullPath = httpsMatcher.group(1);  // owner/repo 或 group/subgroup/project
            String repoName = extractLastSegment(fullPath);
            log.debug("Extracted repo name from HTTPS URL: {} (provider={})", repoName, provider);
            return repoName;
        }

        // SSH 格式: git@github.com:owner/repo → repo
        Matcher sshMatcher = Pattern.compile("git@[^:]+:(.+)").matcher(cleaned);
        if (sshMatcher.find()) {
            String fullPath = sshMatcher.group(1);  // owner/repo 或 group/subgroup/project
            String repoName = extractLastSegment(fullPath);
            log.debug("Extracted repo name from SSH URL: {} (provider={})", repoName, provider);
            return repoName;
        }

        // 无法解析
        throw new BaseException(50400,
            "Invalid repository URL format: " + repoUrl +
            " (provider=" + provider + ", expected: https://... or git@...)");
    }

    /**
     * 提取路径的最后一段（仓库名）
     *
     * @param path 路径（如 owner/repo 或 group/subgroup/project）
     * @return 最后一段（如 repo 或 project）
     */
    private String extractLastSegment(String path) {
        int lastSlash = path.lastIndexOf('/');
        if (lastSlash >= 0 && lastSlash < path.length() - 1) {
            return path.substring(lastSlash + 1);
        }
        return path;  // 没有斜杠，直接返回
    }

    /**
     * 检查技能包是否已初始化
     */
    private void checkSkillPackageNotInitialized(Path repoPath, String skillPackageName) throws BaseException {
        switch (skillPackageName.toLowerCase()) {
            case "trellis":
                if (Files.exists(repoPath.resolve(".trellis"))) {
                    throw new BaseException(50409,
                        "Trellis skill package is already initialized in this repository");
                }
                break;
            case "superpower":
                if (Files.exists(repoPath.resolve(".agents/skills"))) {
                    throw new BaseException(50409,
                        "Superpower skill package is already initialized in this repository");
                }
                break;
            default:
                throw new ByAiArgumentException(50400,
                    "Unsupported skill package: " + skillPackageName +
                    " (supported: trellis, superpower)");
        }
    }

    /**
     * 初始化技能包
     */
    private void initializeSkillPackage(Path repoPath, String skillPackageName) throws BaseException {
        switch (skillPackageName.toLowerCase()) {
            case "trellis":
                trellisInitializer.initialize(repoPath);
                break;
            case "superpower":
                superpowerInitializer.initialize(repoPath);
                break;
            default:
                throw new ByAiArgumentException(50400,
                    "Unsupported skill package: " + skillPackageName);
        }
    }

    /**
     * 获取当前用户ID
     */
    private String getCurrentUserId() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return userId != null ? userId.toString() : "system";
    }

    /**
     * 获取当前用户名
     */
    private String getCurrentUsername() {
        String username = CurrentUserHolder.getCurrentUserName();
        return username != null ? username : "System Administrator";
    }

    /**
     * 获取客户端 IP 地址
     */
    private String getClientIpAddress() {
        try {
            ServletRequestAttributes attributes =
                (ServletRequestAttributes) RequestContextHolder.getRequestAttributes();
            if (attributes != null) {
                HttpServletRequest request = attributes.getRequest();

                // 优先从代理头获取真实 IP
                String ip = request.getHeader("X-Forwarded-For");
                if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
                    ip = request.getHeader("X-Real-IP");
                }
                if (ip == null || ip.isEmpty() || "unknown".equalsIgnoreCase(ip)) {
                    ip = request.getRemoteAddr();
                }

                // X-Forwarded-For 可能包含多个 IP，取第一个
                if (ip != null && ip.contains(",")) {
                    ip = ip.split(",")[0].trim();
                }

                return ip;
            }
        } catch (Exception e) {
            log.warn("Failed to get client IP address", e);
        }
        return "unknown";
    }
}
