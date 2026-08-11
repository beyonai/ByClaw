package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.devloop.provider.GitRepositoryProvider;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoBranchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoFileContentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeNodeDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 项目远程仓库浏览应用服务。 */
@Service
public class ProjectRepositoryService {

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private DevloopPatService patService;

    private final Map<String, GitRepositoryProvider> providers;

    @Autowired
    public ProjectRepositoryService(List<GitRepositoryProvider> providerList) {
        this.providers = providerList.stream().collect(Collectors.toMap(
            provider -> provider.providerType().toLowerCase(Locale.ROOT), Function.identity()));
    }

    /** 查询仓库指定目录的直接子节点；path 为空即查询仓库根目录。 */
    public List<ProjectRepoTreeNodeDTO> listTree(Long projectId, Long repoId, String path, String ref) {
        requireProject(projectId);
        if (repoId == null) {
            throw new BaseException(50500, "project.repo.id.required");
        }
        ProjectRepo repo = projectRepoMapper.selectOne(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getRepoId, repoId).eq(ProjectRepo::getProjectId, projectId));
        if (repo == null) {
            throw new BaseException(50500, "project.repo.not.found");
        }
        String branch = ref == null || ref.trim().isEmpty() ? repo.getDefaultBranch() : ref.trim();
        return resolveProvider(repo).listTree(repo.getRepoUrl(), repo.getRepoFullName(), normalizePath(path), branch,
            currentUserToken());
    }

    /** 按指定分支搜索仓库文件名和路径。 */
    public List<ProjectRepoTreeNodeDTO> searchTree(Long projectId, Long repoId, String keyword, String ref) {
        requireProject(projectId);
        if (repoId == null) {
            throw new BaseException(50500, "project.repo.id.required");
        }
        if (keyword == null || keyword.trim().isEmpty()) {
            throw new BaseException(50500, "project.repo.search.keyword.required");
        }
        ProjectRepo repo = projectRepoMapper.selectOne(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getRepoId, repoId).eq(ProjectRepo::getProjectId, projectId));
        if (repo == null) {
            throw new BaseException(50500, "project.repo.not.found");
        }
        String branch = ref == null || ref.trim().isEmpty() ? repo.getDefaultBranch() : ref.trim();
        return resolveProvider(repo).searchTree(repo.getRepoUrl(), repo.getRepoFullName(), keyword.trim(), branch,
            currentUserToken());
    }

    /** 查询指定仓库的全部远程分支。 */
    public List<ProjectRepoBranchDTO> listBranches(Long repoId) {
        ProjectRepo repo = requireRepo(repoId);
        return resolveProvider(repo).listBranches(repo.getRepoUrl(), repo.getRepoFullName(), currentUserToken());
    }

    /** 查询指定远程分支上的文件内容。 */
    public ProjectRepoFileContentDTO getFileContent(Long repoId, String branch, String path) {
        ProjectRepo repo = requireRepo(repoId);
        if (branch == null || branch.trim().isEmpty()) {
            throw new BaseException(50500, "project.repo.branch.required");
        }
        String normalizedPath = normalizePath(path);
        if (normalizedPath == null) {
            throw new BaseException(50500, "project.repo.file.path.required");
        }
        return resolveProvider(repo).getFileContent(repo.getRepoUrl(), repo.getRepoFullName(), branch.trim(),
            normalizedPath, currentUserToken());
    }

    private ProjectRepo requireRepo(Long repoId) {
        if (repoId == null) {
            throw new BaseException(50500, "project.repo.id.required");
        }
        ProjectRepo repo = projectRepoMapper.selectById(repoId);
        if (repo == null) {
            throw new BaseException(50500, "project.repo.not.found");
        }
        requireProject(repo.getProjectId());
        return repo;
    }

    private GitRepositoryProvider resolveProvider(ProjectRepo repo) {
        String providerName = repo.getProvider() == null ? "github" : repo.getProvider().toLowerCase(Locale.ROOT);
        GitRepositoryProvider provider = providers.get(providerName);
        if (provider == null) {
            throw new BaseException(50500, "project.repo.provider.unsupported");
        }
        return provider;
    }

    private String currentUserToken() {
        return patService.getGitHubPat(String.valueOf(CurrentUserHolder.getCurrentUserId()));
    }

    private void requireProject(Long projectId) {
        if (projectId == null) {
            throw new BaseException(50500, "project.id.required");
        }
        Project project = projectService.findById(projectId);
        if (project == null || DeleteFlag.DELETED.equals(project.getDeleteFlag())) {
            throw new BaseException(50500, "project.not.found");
        }
    }

    private String normalizePath(String path) {
        if (path == null) return null;
        String normalized = path.trim().replace('\\', '/');
        while (normalized.startsWith("/")) normalized = normalized.substring(1);
        while (normalized.endsWith("/")) normalized = normalized.substring(0, normalized.length() - 1);
        return normalized.isEmpty() ? null : normalized;
    }
}
