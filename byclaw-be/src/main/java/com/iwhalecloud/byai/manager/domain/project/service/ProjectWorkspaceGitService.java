package com.iwhalecloud.byai.manager.domain.project.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.project.ProjectInitService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitSubmodulePathResolver;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Locale;
import java.util.Optional;

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
}
