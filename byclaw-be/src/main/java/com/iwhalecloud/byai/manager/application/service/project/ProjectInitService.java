package com.iwhalecloud.byai.manager.application.service.project;

import java.io.IOException;
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
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.exception.ByAiArgumentException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.application.service.session.ByClawUserWorkspacePaths;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.application.service.devloop.GitHubCredentialResolver;
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
import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.apache.commons.lang3.StringUtils;
import org.springframework.data.redis.core.StringRedisTemplate;
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

    @Value("${file.storage.local.path}")
    private String fileStorageLocalPath;

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
    private UserBucketNamingService userBucketNamingService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private StringRedisTemplate stringRedisTemplate;

    @Autowired
    private ObjectMapper objectMapper;

    @Autowired
    private GitHubCredentialResolver githubCredentialResolver;

    /**
     * 初始化项目工作目录。
     *
     * @param projectId 项目 ID
     * @return 项目工作目录
     */
    public Path initProjectWorkspace(Long projectId) {
        Path projectWorkspace = Paths.get(fileStorageLocalPath, resolveCurrentUserBucket(), userFsRootPathSegment(),
            "projects",
            String.valueOf(projectId));
        try {
            Files.createDirectories(projectWorkspace);
            return projectWorkspace;
        }
        catch (IOException e) {
            throw new IllegalStateException("Failed to create project workspace: " + projectWorkspace, e);
        }
    }

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
            // 自动填充 submodules：查询 repo_type='code' 的仓库
            if (request.getSubmodules() == null || request.getSubmodules().isEmpty()) {
                List<ProjectRepo> codeRepos = projectRepoMapper.selectList(
                    new LambdaQueryWrapper<ProjectRepo>()
                        .eq(ProjectRepo::getProjectId, request.getProjectId())
                        .eq(ProjectRepo::getRepoType, "code")
                );

                if (!codeRepos.isEmpty()) {
                    List<SubmoduleInfo> submodules = new ArrayList<>();
                    for (ProjectRepo repo : codeRepos) {
                        SubmoduleInfo submodule = new SubmoduleInfo();
                        submodule.setUrl(repo.getRepoUrl());
                        submodule.setBranch(repo.getDefaultBranch());
                        // 使用 repoFullName 作为子模块路径（例如：beyonai/ByClaw）
                        submodule.setPath(repo.getRepoFullName());
                        submodules.add(submodule);
                    }
                    request.setSubmodules(submodules);
                    log.debug("Auto-filled {} code repositories as submodules for projectId={}",
                        submodules.size(), request.getProjectId());
                }
            }

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

        // 自动填充 submodules：查询 repo_type='code' 的仓库
        if (request.getSubmodules() == null || request.getSubmodules().isEmpty()) {
            List<ProjectRepo> codeRepos = projectRepoMapper.selectList(
                new LambdaQueryWrapper<ProjectRepo>()
                    .eq(ProjectRepo::getProjectId, request.getProjectId())
                    .eq(ProjectRepo::getRepoType, "code")
            );

            if (!codeRepos.isEmpty()) {
                List<SubmoduleInfo> submodules = new ArrayList<>();
                for (ProjectRepo repo : codeRepos) {
                    SubmoduleInfo submodule = new SubmoduleInfo();
                    submodule.setUrl(repo.getRepoUrl());
                    submodule.setBranch(repo.getDefaultBranch());
                    // 使用 repoFullName 作为子模块路径（例如：beyonai/ByClaw）
                    submodule.setPath(repo.getRepoFullName());
                    submodules.add(submodule);
                }
                request.setSubmodules(submodules);
                log.debug("Auto-filled {} code repositories as submodules for projectId={}",
                    submodules.size(), request.getProjectId());
            }
        }

        // 创建异步任务
        String taskId = taskManager.createTask(userId, requestId,
            "project_" + request.getProjectId(),
            request.getSkillPackages() != null && !request.getSkillPackages().isEmpty()
                ? String.join(",", request.getSkillPackages()) : "none");

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
        log.debug("[Step 1/14] Starting executeInitialization for projectId={}", request.getProjectId());

        // 1. 查询项目
        log.debug("[Step 1/14] Querying project by projectId={}", request.getProjectId());
        Project project = projectService.findById(request.getProjectId());
        if (project == null) {
            log.error("[Step 1/14] Project not found: projectId={}", request.getProjectId());
            throw new BaseException(50404, "Project not found: " + request.getProjectId());
        }
        log.debug("[Step 1/14] Project found: projectId=, projectName={}, projectType={}",
            project.getProjectId(), project.getProjectName(), project.getProjectType());

        // 2. 查询 workspace 类型仓库
        log.debug("[Step 2/14] Querying workspace repository for projectId={}", request.getProjectId());
        ProjectRepo repo = findWorkspaceRepo(request.getProjectId());
        if (repo == null) {
            log.error("[Step 2/14] No workspace repository configured for project: {}", project.getProjectName());
            throw new BaseException(50404,
                "No workspace repository configured for project: " + project.getProjectName());
        }
        log.debug("[Step 2/14] Workspace repo found: repoId={}, provider={}, repoFullName={}, repoUrl={}",
            repo.getRepoId(), repo.getProvider(), repo.getRepoFullName(), repo.getRepoUrl());

        // 3. 构建本地仓库路径
        log.debug("[Step 3/14] Building local repository path");
        Path repoPath = buildRepoPath(repo);
        String normalizedPath = repoPath.toString();
        log.debug("[Step 3/14] Local path resolved: {}", normalizedPath);

        log.info("Starting project initialization: projectId={}, provider={}, repoFullName={}, repoUrl={}, path={}, skillPackages={}, submodules={}",
            request.getProjectId(), repo.getProvider(), repo.getRepoFullName(), repo.getRepoUrl(),
            normalizedPath, request.getSkillPackages(),
            request.getSubmodules() != null ? request.getSubmodules().size() : 0);

        // 3.5 获取当前用户的 GH_TOKEN（用于 Git 认证）
        log.debug("[Step 3.5/14] Retrieving GitHub token for user authentication");
        String ghToken = getUserGitHubToken();
        if (ghToken == null) {
            log.error("[Step 3.5/14] GitHub token not found for current user");
            throw new BaseException(50403,
                "GitHub Token (GH_TOKEN) is required for Git operations. " +
                "Please configure your GitHub Personal Access Token in user settings.");
        }
        log.debug("[Step 3.5/14] GitHub token retrieved successfully (length={})", ghToken.length());

        // 4. 验证仓库已克隆到本地，如果不存在则自动克隆
        log.debug("[Step 4/14] Checking if repository exists locally: {}", normalizedPath);
        if (!Files.exists(repoPath)) {
            log.warn("[Step 4/14] Repository not found locally: {}. Attempting to clone from: {}",
                normalizedPath, repo.getRepoUrl());

            try {
                // 自动克隆仓库
                String branch = request.getRepoBranch() != null && !request.getRepoBranch().isBlank()
                    ? request.getRepoBranch()
                    : repo.getDefaultBranch();
                log.debug("[Step 4/14] Cloning repository: branch={}", branch);

                // 将 token 嵌入 URL（用于 HTTPS 认证）
                String authenticatedUrl = injectTokenIntoUrl(repo.getRepoUrl(), ghToken);
                gitCommandExecutor.cloneRepository(authenticatedUrl, repoPath, branch);

                log.info("[Step 4/14] Successfully cloned repository to: {}", normalizedPath);
            } catch (BaseException e) {
                log.error("[Step 4/14] Failed to clone repository: {}", repo.getRepoUrl(), e);
                throw new BaseException(50500,
                    "Failed to clone repository: " + repo.getRepoUrl() +
                    ". Error: " + e.getMessage(), e);
            }
        } else {
            log.debug("[Step 4/14] Repository already exists locally: {}", normalizedPath);
        }

        log.debug("[Step 4/14] Verifying Git repository structure");
        if (!gitCommandExecutor.isGitRepository(repoPath)) {
            log.error("[Step 4/14] Path is not a valid Git repository: {}", normalizedPath);
            throw new BaseException(50400,
                "Path is not a Git repository (missing .git directory): " + normalizedPath);
        }
        log.debug("[Step 4/14] Git repository verified successfully");

        // 5. 获取锁（非阻塞）
        log.debug("[Step 5/14] Acquiring repository lock: {}", normalizedPath);
        if (!repoLockManager.acquireLock(normalizedPath)) {
            log.error("[Step 5/14] Failed to acquire lock - repository is locked by another process: {}", normalizedPath);
            throw new BaseException(50409,
                "Repository is currently being initialized by another process: " + normalizedPath);
        }
        log.debug("[Step 5/14] Repository lock acquired successfully");

        try {
            // 6. 更新项目状态为 initializing（仅研发项目）
            // 同时把 init_session_id 清成 0：这一段是服务端建工作区，没有会话。上一轮架构员工聊天可能留了个旧会话ID，
            // 不清掉的话 DevloopWorkspaceInitJob 会按「initializing + 有会话」把这个项目捞去读那条废会话的状态文件，
            // 读到 completed 就在工作区还没建完时把项目提前置 ready。
            log.debug("[Step 6/14] Updating project status to 'initializing'");
            if ("develop".equals(project.getProjectType())) {
                try {
                    Project projectUpdate = new Project();
                    projectUpdate.setProjectId(project.getProjectId());
                    projectUpdate.setInitStatus("initializing");
                    projectUpdate.setInitSessionId(0L);
                    projectUpdate.setInitFailReason("");
                    projectUpdate.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    projectUpdate.setUpdateTime(new java.util.Date());
                    projectService.update(projectUpdate);
                    log.info("[Step 6/14] Project init_status updated to 'initializing': projectId={}", request.getProjectId());
                } catch (Exception e) {
                    log.error("[Step 6/14] Failed to update project init_status to 'initializing': projectId={}",
                        request.getProjectId(), e);
                    // 继续执行，状态更新失败不影响初始化流程
                }
            } else {
                log.debug("[Step 6/14] Skipping status update - project type is not 'develop': projectType={}", project.getProjectType());
            }

            // 7. 检查技能包是否已初始化（遍历所有技能包）
            List<String> skillPackagesToInit = new ArrayList<>();
            if (request.getSkillPackages() != null && !request.getSkillPackages().isEmpty()) {
                log.debug("[Step 7/14] Checking {} skill package(s) for initialization", request.getSkillPackages().size());
                for (String skillPackage : request.getSkillPackages()) {
                    if (skillPackage != null && !skillPackage.isBlank()) {
                        log.debug("[Step 7/14] Checking if skill package already initialized: {}", skillPackage);
                        checkSkillPackageNotInitialized(repoPath, skillPackage);
                        skillPackagesToInit.add(skillPackage);
                        log.debug("[Step 7/14] Skill package check passed - not yet initialized: {}", skillPackage);
                    }
                }
                log.debug("[Step 7/14] All skill packages checked: {} to be initialized", skillPackagesToInit.size());
            } else {
                log.debug("[Step 7/14] Skipping skill package check - no skill packages specified");
            }

            // 8. 切换分支（如果指定）
            log.debug("[Step 8/14] Checking current branch");
            String currentBranch = gitCommandExecutor.getCurrentBranch(repoPath);
            log.debug("[Step 8/14] Current branch: {}", currentBranch);
            if (request.getRepoBranch() != null && !request.getRepoBranch().isBlank()) {
                log.debug("[Step 8/14] Switching to requested branch: {}", request.getRepoBranch());
                gitCommandExecutor.checkoutBranch(repoPath, request.getRepoBranch());
                currentBranch = request.getRepoBranch();
                log.info("[Step 8/14] Switched to branch: {}", currentBranch);
            } else {
                log.debug("[Step 8/14] No branch switch requested - staying on: {}", currentBranch);
            }

            // 9. 添加子模块（如果有）
            log.debug("[Step 9/14] Processing submodules");
            List<String> addedSubmodules = new ArrayList<>();
            if (request.getSubmodules() != null && !request.getSubmodules().isEmpty()) {
                log.debug("[Step 9/14] Adding {} submodule(s)", request.getSubmodules().size());
                for (SubmoduleInfo submodule : request.getSubmodules()) {
                    // 为子模块 URL 注入 token（每个请求都要带上认证信息）
                    String authenticatedUrl = injectTokenIntoUrl(submodule.getUrl(), ghToken);
                    log.debug("[Step 9/14] Adding submodule: url={}, path={}, branch={}",
                        submodule.getUrl(), submodule.getPath(), submodule.getBranch());
                    gitCommandExecutor.addSubmodule(
                        repoPath,
                        authenticatedUrl,  // 使用带 token 的 URL
                        submodule.getPath(),
                        submodule.getBranch()
                    );
                    addedSubmodules.add(submodule.getPath());
                    log.info("[Step 9/14] Submodule added successfully: {}", submodule.getPath());
                }
                log.debug("[Step 9/14] All submodules added: count={}", addedSubmodules.size());
            } else {
                log.debug("[Step 9/14] No submodules to add");
            }

            // 10. 初始化技能包（遍历处理所有技能包）
            List<String> initializedSkillPackages = new ArrayList<>();
            if (!skillPackagesToInit.isEmpty()) {
                log.debug("[Step 10/14] Initializing {} skill package(s)", skillPackagesToInit.size());
                for (String skillPackage : skillPackagesToInit) {
                    log.debug("[Step 10/14] Initializing skill package: {}", skillPackage);
                    initializeSkillPackage(repoPath, skillPackage);
                    initializedSkillPackages.add(skillPackage);
                    log.info("[Step 10/14] Skill package initialized successfully: {}", skillPackage);
                }
                log.debug("[Step 10/14] All skill packages initialized: count={}", initializedSkillPackages.size());
            } else {
                log.debug("[Step 10/14] Skipping skill package initialization - no skill packages specified");
            }

            // 11. 提交变更（如果启用）
            log.debug("[Step 11/14] Processing commit");
            String commitHash = null;
            boolean newCommit = false;
            if (Boolean.TRUE.equals(request.getAutoCommit())) {
                log.debug("[Step 11/14] Auto-commit enabled - proceeding with commit");
                // 先获取提交前的 commit hash
                String oldCommitHash = gitCommandExecutor.getCurrentCommitHash(repoPath);
                log.debug("[Step 11/14] Current commit hash before changes: {}", oldCommitHash);

                String commitMessage = request.getCommitMessage();
                if (commitMessage == null || commitMessage.isBlank()) {
                    // 根据实际操作生成提交消息
                    if (!initializedSkillPackages.isEmpty()) {
                        commitMessage = String.format("chore: init %s skill package(s)", String.join(", ", initializedSkillPackages));
                        if (!addedSubmodules.isEmpty()) {
                            commitMessage += " and add " + addedSubmodules.size() + " submodule(s)";
                        }
                    } else if (!addedSubmodules.isEmpty()) {
                        commitMessage = "chore: add " + addedSubmodules.size() + " submodule(s)";
                    } else {
                        commitMessage = "chore: update repository";
                    }
                    log.debug("[Step 11/14] Generated commit message: {}", commitMessage);
                } else {
                    log.debug("[Step 11/14] Using provided commit message: {}", commitMessage);
                }

                // 从 Redis 获取 Git 用户信息（与 GH_TOKEN 同级）
                String ghUser = getUserGitUser();
                String ghEmail = getUserGitEmail();
                log.debug("[Step 11/14] Git user info: GH_USER={}, GH_EMAIL={}",
                    ghUser != null ? "configured" : "default",
                    ghEmail != null ? "configured" : "default");

                // 提交变更
                commitHash = gitCommandExecutor.commitAll(repoPath, commitMessage, ghUser, ghEmail);
                log.debug("[Step 11/14] Commit completed: hash={}", commitHash);

                // 对比提交前后的 hash，判断是否有新提交
                newCommit = !commitHash.equals(oldCommitHash);
                if (newCommit) {
                    log.info("[Step 11/14] New commit created: {}", commitHash.substring(0, Math.min(8, commitHash.length())));
                } else {
                    log.debug("[Step 11/14] No changes to commit - hash unchanged: {}", commitHash.substring(0, Math.min(8, commitHash.length())));
                }
            } else {
                log.debug("[Step 11/14] Auto-commit disabled - skipping commit");
            }

            // 12. 推送到远程（如果启用且有新提交）
            log.debug("[Step 12/14] Processing push to remote");
            boolean pushed = false;
            if (Boolean.TRUE.equals(request.getAutoPush()) && newCommit) {
                log.debug("[Step 12/14] Auto-push enabled and new commit exists - proceeding with push");
                // 临时设置远程 URL 为带 token 的版本（用于认证）
                String authenticatedUrl = injectTokenIntoUrl(repo.getRepoUrl(), ghToken);
                log.debug("[Step 12/14] Temporarily setting authenticated remote URL");
                gitCommandExecutor.executeCommand(repoPath, "git", "remote", "set-url", "origin", authenticatedUrl);

                try {
                    log.debug("[Step 12/14] Pushing to branch: {}", currentBranch);
                    gitCommandExecutor.push(repoPath, currentBranch);
                    pushed = true;
                    log.info("[Step 12/14] Successfully pushed to remote: branch={}", currentBranch);
                } finally {
                    // 恢复原始 URL（移除 token）
                    log.debug("[Step 12/14] Restoring original remote URL");
                    gitCommandExecutor.executeCommand(repoPath, "git", "remote", "set-url", "origin", repo.getRepoUrl());
                }
            } else {
                if (!Boolean.TRUE.equals(request.getAutoPush())) {
                    log.debug("[Step 12/14] Auto-push disabled - skipping push");
                } else if (!newCommit) {
                    log.debug("[Step 12/14] No new commit - skipping push");
                }
            }

            // 13. 更新项目初始化状态为 initialized
            // 到这里只代表工作区建好了，还不是 ready：ready 要等架构数字员工把骨架聊完，由 DevloopWorkspaceInitJob
            // 读会话状态文件报 completed 才置。中间这个 initialized 态就是前端「去跟架构聊天」按钮的出现条件。
            log.debug("[Step 13/14] Updating project status to 'initialized'");
            try {
                if (project != null && "develop".equals(project.getProjectType())) {
                    Project projectUpdate = new Project();
                    projectUpdate.setProjectId(project.getProjectId());
                    projectUpdate.setInitStatus("initialized");
                    projectUpdate.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                    projectUpdate.setUpdateTime(new java.util.Date());
                    projectService.update(projectUpdate);
                    log.info("[Step 13/14] Project init_status updated to 'initialized': projectId={}", request.getProjectId());
                } else {
                    log.debug("[Step 13/14] Skipping status update - project type is not 'develop'");
                }
            } catch (Exception e) {
                log.error("[Step 13/14] Failed to update project init_status to 'initialized': projectId={}",
                    request.getProjectId(), e);
                // 不抛出异常，因为初始化本身已成功，只是状态更新失败
            }

            // 14. 构建成功响应
            log.debug("[Step 14/14] Building success response");
            ProjectInitResponse response = ProjectInitResponse.success(
                normalizedPath,
                currentBranch,
                initializedSkillPackages,
                addedSubmodules,
                commitHash,
                pushed
            );

            log.info("[Step 14/14] Project initialization completed successfully: path={}, branch={}, skillPackages={}, commit={}, pushed={}",
                normalizedPath, currentBranch, initializedSkillPackages,
                commitHash != null ? commitHash.substring(0, Math.min(8, commitHash.length())) : "none", pushed);
            return response;

        } catch (Exception e) {
            log.error("Project initialization failed: {}", normalizedPath, e);
            throw e;
        } finally {
            // 释放锁
            log.debug("[Cleanup] Releasing repository lock: {}", normalizedPath);
            repoLockManager.releaseLock(normalizedPath);
            log.debug("[Cleanup] Repository lock released");
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
     * 路径规则：{file.storage.local.path}/{user_bucket}/projects/{projectId}/repos/{workspace_repo_name}
     * 示例：/data/byclaw-user001/projects/11038149/repos/ByClaw-Workspace
     *
     * @param repo ProjectRepo 实体（workspace 类型仓库）
     * @return 本地仓库路径
     * @throws BaseException 如果 repoFullName 或 repoUrl 无效
     */
    private Path buildRepoPath(ProjectRepo repo) throws BaseException {
        // 1. 提取仓库名称（repoFullName 的最后一部分）
        String repoName = extractRepoName(repo);

        // Git 根目录按项目隔离，避免不同项目的工作区仓库互相覆盖。
        Path root = Paths.get(gitWorkspaceConfig.getRoot(repo.getProjectId(), resolveCurrentUserBucket()))
            .toAbsolutePath().normalize();
        Path repositoryPath = root.resolve(repoName).normalize();
        if (!root.equals(repositoryPath.getParent())) {
            throw new BaseException(50400, "Invalid repository name: " + repoName);
        }
        return repositoryPath;
    }

    /**
     * 获取项目仓库在当前用户项目工作区中的实际路径。
     *
     * <p>仓库浏览与 worktree 解析必须和初始化流程共用同一路径规则，避免各处重复拼接用户桶、项目和仓库名。</p>
     *
     * @param repo 项目仓库配置
     * @return 本地仓库的规范化绝对路径
     */
    public Path getProjectRepositoryPath(ProjectRepo repo) {
        return buildRepoPath(repo).toAbsolutePath().normalize();
    }

    /**
     * 解析当前登录用户的用户桶名称。
     *
     * @return 当前登录用户对应的规范化用户桶名称
     */
    private String resolveCurrentUserBucket() {
        return userBucketNamingService.buildUserBucketName(CurrentUserHolder.getCurrentUserCode());
    }

    private String userFsRootPathSegment() {
        return StringUtils.stripStart(ByClawUserWorkspacePaths.USER_FS_OBJECT_KEY_ROOT_PREFIX, "/");
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

    /**
     * 从 Redis 获取当前用户的 GitHub Token
     *
     * @return GitHub Token，如果未配置则返回 null
     */
    private String getUserGitHubToken() {
        String connectorToken = githubCredentialResolver == null
            ? null : githubCredentialResolver.resolve(CurrentUserHolder.getCurrentUserId());
        if (StringUtils.isNotBlank(connectorToken)) {
            return connectorToken;
        }
        try {
            String userCode = CurrentUserHolder.getCurrentUserCode();
            if (StringUtils.isBlank(userCode)) {
                log.warn("Cannot get GitHub token: current user code is blank");
                return null;
            }

            String redisKey = UserPrivateParamApplicationService.buildPrivateParamRedisKey(userCode);
            String cacheJson = stringRedisTemplate.opsForValue().get(redisKey);

            if (StringUtils.isBlank(cacheJson)) {
                log.warn("User {} has no private params configured in Redis", userCode);
                return null;
            }

            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> cacheData = objectMapper.readValue(cacheJson, java.util.Map.class);
            @SuppressWarnings("unchecked")
            java.util.Map<String, String> params = (java.util.Map<String, String>) cacheData.get("params");

            if (params == null || params.isEmpty()) {
                log.warn("User {} has empty private params", userCode);
                return null;
            }

            String ghToken = params.get("GH_TOKEN");
            if (StringUtils.isBlank(ghToken)) {
                log.warn("User {} has not configured GH_TOKEN", userCode);
                return null;
            }

            log.debug("Retrieved GH_TOKEN for user {}", userCode);
            return ghToken;

        } catch (Exception e) {
            log.error("Failed to get GitHub token from Redis", e);
            return null;
        }
    }

    /**
     * 从 Redis 获取当前用户的 Git 用户名（GH_USER）
     *
     * @return Git 用户名，如果未配置则返回 null
     */
    private String getUserGitUser() {
        try {
            String userCode = CurrentUserHolder.getCurrentUserCode();
            if (StringUtils.isBlank(userCode)) {
                log.debug("Cannot get Git user: current user code is blank");
                return null;
            }

            String redisKey = UserPrivateParamApplicationService.buildPrivateParamRedisKey(userCode);
            String cacheJson = stringRedisTemplate.opsForValue().get(redisKey);

            if (StringUtils.isBlank(cacheJson)) {
                log.debug("User {} has no private params configured in Redis", userCode);
                return null;
            }

            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> cacheData = objectMapper.readValue(cacheJson, java.util.Map.class);
            @SuppressWarnings("unchecked")
            java.util.Map<String, String> params = (java.util.Map<String, String>) cacheData.get("params");

            if (params == null || params.isEmpty()) {
                log.debug("User {} has empty private params", userCode);
                return null;
            }

            String ghUser = params.get("GH_USER");
            if (StringUtils.isBlank(ghUser)) {
                log.debug("User {} has not configured GH_USER, will use default", userCode);
                return null;
            }

            log.debug("Retrieved GH_USER for user {}: {}", userCode, ghUser);
            return ghUser;

        } catch (Exception e) {
            log.error("Failed to get Git user from Redis", e);
            return null;
        }
    }

    /**
     * 从 Redis 获取当前用户的 Git 邮箱（GH_EMAIL）
     *
     * @return Git 邮箱，如果未配置则返回 null
     */
    private String getUserGitEmail() {
        try {
            String userCode = CurrentUserHolder.getCurrentUserCode();
            if (StringUtils.isBlank(userCode)) {
                log.debug("Cannot get Git email: current user code is blank");
                return null;
            }

            String redisKey = UserPrivateParamApplicationService.buildPrivateParamRedisKey(userCode);
            String cacheJson = stringRedisTemplate.opsForValue().get(redisKey);

            if (StringUtils.isBlank(cacheJson)) {
                log.debug("User {} has no private params configured in Redis", userCode);
                return null;
            }

            @SuppressWarnings("unchecked")
            java.util.Map<String, Object> cacheData = objectMapper.readValue(cacheJson, java.util.Map.class);
            @SuppressWarnings("unchecked")
            java.util.Map<String, String> params = (java.util.Map<String, String>) cacheData.get("params");

            if (params == null || params.isEmpty()) {
                log.debug("User {} has empty private params", userCode);
                return null;
            }

            String ghEmail = params.get("GH_EMAIL");
            if (StringUtils.isBlank(ghEmail)) {
                log.debug("User {} has not configured GH_EMAIL, will use default", userCode);
                return null;
            }

            log.debug("Retrieved GH_EMAIL for user {}: {}", userCode, ghEmail);
            return ghEmail;

        } catch (Exception e) {
            log.error("Failed to get Git email from Redis", e);
            return null;
        }
    }

    /**
     * 将 GitHub Token 注入到 Git URL 中（用于 HTTPS 认证）
     *
     * @param repoUrl 原始仓库 URL
     * @param token GitHub Personal Access Token
     * @return 带 token 的 URL
     */
    private String injectTokenIntoUrl(String repoUrl, String token) {
        if (repoUrl == null || token == null) {
            return repoUrl;
        }

        // 仅处理 HTTPS URL
        if (repoUrl.startsWith("https://")) {
            // 格式: https://github.com/owner/repo.git -> https://oauth2:TOKEN@github.com/owner/repo.git
            // 或: https://gitlab.com/owner/repo.git -> https://oauth2:TOKEN@gitlab.com/owner/repo.git
            return repoUrl.replace("https://", "https://oauth2:" + token + "@");
        }

        // SSH URL 不需要注入 token
        log.debug("URL is not HTTPS, skipping token injection: {}", repoUrl);
        return repoUrl;
    }
}
