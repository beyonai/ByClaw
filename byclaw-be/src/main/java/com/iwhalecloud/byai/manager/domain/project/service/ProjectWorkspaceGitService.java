package com.iwhalecloud.byai.manager.domain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.project.ProjectInitService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitSubmodulePathResolver;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitSubmodulePathResolver.ResolvedSubmodule;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.Map;
import java.util.HashMap;
import java.util.stream.Stream;

/**
 * 项目 workspace 仓库及其 worktree 的本地路径解析服务。
 */
@Service
public class ProjectWorkspaceGitService {

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ProjectInitService projectInitService;

    /** 查询项目约定的 workspace 仓库。 */
    public Optional<ProjectRepo> findWorkspaceRepo(Long projectId) {
        if (projectId == null) {
            return Optional.empty();
        }
        List<ProjectRepo> repos = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getProjectId, projectId).orderByAsc(ProjectRepo::getRepoId));
        return repos.stream().filter(repo -> "workspace".equalsIgnoreCase(repo.getRepoType())).findFirst();
    }

    /** 获取 workspace 仓库的本地实际路径；仓库尚未初始化时返回空。 */
    public Optional<Path> resolveWorkspaceRepository(Long projectId) {
        return findWorkspaceRepo(projectId).flatMap(repo -> {
            Path configuredPath = projectInitService.getProjectRepositoryPath(repo);
            // 线上项目采用 environment 根仓 + .gitmodules 子模块布局，
            // workspace 根仓固定在 /by/projects/{projectId}，不再使用 /repos/{repoName}。
            Path projectRoot = configuredPath.getParent() == null ? null : configuredPath.getParent().getParent();
            return isGitRepository(projectRoot) ? Optional.of(projectRoot) : Optional.empty();
        });
    }

    private boolean isGitRepository(Path path) {
        return path != null && Files.isDirectory(path) && Files.exists(path.resolve(".git"));
    }

    /** workspace 仓库返回项目主仓路径，代码仓库按 .gitmodules 中的真实子模块路径解析。 */
    public Optional<Path> resolveRepository(ProjectRepo repo) {
        if (repo == null) {
            return Optional.empty();
        }
        // DSH 将仓库直接放在 /by/projects/{projectId}/repos/{repoName}，没有 codeagent 的
        // 项目根仓和 .gitmodules。优先尝试仓库自身路径，不影响后面的 codeagent 规则。
        Path directPath = projectInitService.getProjectRepositoryPath(repo);
        if (isGitRepository(directPath)) {
            return Optional.of(directPath);
        }
        Optional<Path> workspacePath = resolveWorkspaceRepository(repo.getProjectId());
        if (workspacePath.isEmpty()) {
            return Optional.empty();
        }
        if ("workspace".equalsIgnoreCase(repo.getRepoType())) {
            return workspacePath;
        }
        return new GitSubmodulePathResolver().resolve(workspacePath.get(), repo)
            .filter(path -> Files.isDirectory(path) && Files.exists(path.resolve(".git")));
    }

    /**
     * 返回数据库仓库配置与 workspace 实际 Git 仓库的交集。
     * workspace 根仓排在首位，其余代码仓库按 .gitmodules 中的顺序返回。
     */
    public List<ResolvedRepository> resolveRepositories(Long projectId) {
        if (projectId == null) {
            return List.of();
        }
        List<ProjectRepo> repos = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getProjectId, projectId).orderByAsc(ProjectRepo::getRepoId));
        ProjectRepo workspaceRepo = repos.stream()
            .filter(repo -> "workspace".equalsIgnoreCase(repo.getRepoType())).findFirst().orElse(null);
        Path workspacePath = workspaceRepo == null ? null : resolveCodeagentWorkspacePath(workspaceRepo);
        if (isGitRepository(workspacePath)) {
            List<ResolvedRepository> resolved = new java.util.ArrayList<>();
            resolved.add(new ResolvedRepository(workspaceRepo, workspacePath));
            List<ProjectRepo> codeRepos = repos.stream()
                .filter(repo -> !"workspace".equalsIgnoreCase(repo.getRepoType())).toList();
            for (ResolvedSubmodule submodule : new GitSubmodulePathResolver().resolveAll(workspacePath, codeRepos)) {
                if (isGitRepository(submodule.path())) {
                    resolved.add(new ResolvedRepository(submodule.repo(), submodule.path()));
                }
            }
            return resolved;
        }

        // DSH/无 workspace 场景：按数据库仓库名解析 repos/ 下的独立 Git 仓库。
        List<ResolvedRepository> resolved = new java.util.ArrayList<>();
        Map<String, Path> discovered = discoverDshRepositories(repos);
        for (ProjectRepo repo : repos) {
            Path repositoryPath = projectInitService.getProjectRepositoryPath(repo);
            if (!isGitRepository(repositoryPath)) {
                repositoryPath = discovered.get(repositoryName(repo));
            }
            if (isGitRepository(repositoryPath)) {
                resolved.add(new ResolvedRepository(repo, repositoryPath));
            }
        }
        return resolved;
    }

    /**
     * DSH 的仓库目录以实际 clone 名称为准。数据库中的 repoFullName 可能来自不同 provider，
     * 或者初始化时使用了 URL 解析结果；当精确拼接路径失败时，从同一项目的 repos 目录发现 Git 仓库。
     */
    private Map<String, Path> discoverDshRepositories(List<ProjectRepo> repos) {
        Map<String, Path> discovered = new HashMap<>();
        if (repos == null || repos.isEmpty()) {
            return discovered;
        }
        for (ProjectRepo repo : repos) {
            Path configured = projectInitService.getProjectRepositoryPath(repo);
            Path reposRoot = configured == null ? null : configured.getParent();
            if (reposRoot == null || !Files.isDirectory(reposRoot)) {
                continue;
            }
            try (Stream<Path> children = Files.list(reposRoot)) {
                children.filter(this::isGitRepository)
                    .forEach(path -> discovered.putIfAbsent(path.getFileName().toString().toLowerCase(Locale.ROOT), path));
            }
            catch (Exception ignored) {
                // 目录不可读时保留精确路径结果，不影响 codeagent 及已有仓库浏览。
            }
        }
        return discovered;
    }

    private String repositoryName(ProjectRepo repo) {
        String value = repo == null ? null : repo.getRepoFullName();
        if (value == null || value.isBlank()) {
            value = repo == null ? null : repo.getRepoUrl();
        }
        if (value == null || value.isBlank()) {
            return "";
        }
        String cleaned = value.replace('\\', '/');
        int slash = cleaned.lastIndexOf('/');
        String name = slash >= 0 ? cleaned.substring(slash + 1) : cleaned;
        if (name.endsWith(".git")) {
            name = name.substring(0, name.length() - 4);
        }
        return name.toLowerCase(Locale.ROOT);
    }

    private Path resolveCodeagentWorkspacePath(ProjectRepo workspaceRepo) {
        Path configuredPath = projectInitService.getProjectRepositoryPath(workspaceRepo);
        return configuredPath.getParent() == null ? null : configuredPath.getParent().getParent();
    }

    /** 定位项目 workspace 根仓；项目代码实际位于 /by/projects/{projectId} 下。 */
    public Optional<Path> resolveSessionWorktree(Long projectId, Object sessionId) {
        if (sessionId == null) {
            return Optional.empty();
        }
        return resolveWorkspaceRepository(projectId);
    }

    /** 将用户桶中的宿主机路径转换成沙箱内可见的 /by 绝对路径。 */
    public Optional<String> toSandboxPath(Path hostPath) {
        if (hostPath == null) {
            return Optional.empty();
        }
        String normalized = hostPath.toAbsolutePath().normalize().toString().replace('\\', '/');
        int index = normalized.toLowerCase(Locale.ROOT).indexOf("/by/");
        if (index < 0) {
            return Optional.empty();
        }
        String sandboxPath = normalized.substring(index);
        return Optional.of(sandboxPath.endsWith("/") ? sandboxPath : sandboxPath + "/");
    }

    public record ResolvedRepository(ProjectRepo repo, Path path) {
    }
}
