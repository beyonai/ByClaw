package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.devloop.DeleteFlag;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.devloop.provider.GitRepositoryProvider;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.project.service.ProjectWorkspaceGitService;
import com.iwhalecloud.byai.manager.domain.project.service.GitCommandExecutor;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoBranchDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoFileContentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeNodeDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import lombok.extern.slf4j.Slf4j;

import java.nio.file.Path;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.Base64;
import java.util.Comparator;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;
import java.util.function.Function;
import java.util.stream.Collectors;

/** 项目仓库浏览应用服务，本地实际 Git 仓库优先，远端 provider 兜底。 */
@Slf4j
@Service
public class ProjectRepositoryService {

    @Autowired
    private ProjectService projectService;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private ProjectWorkspaceGitService projectWorkspaceGitService;

    @Autowired
    private GitCommandExecutor gitCommandExecutor;

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
        String branch = resolveBranch(projectId, repo, ref);
        try {
            Path localRepo = projectWorkspaceGitService.resolveRepository(repo).orElseThrow();
            return listLocalTree(localRepo, normalizePath(path), branch);
        }
        catch (Exception e) {
            log.info("Local repository tree unavailable, falling back to provider, projectId={}, repoId={}",
                projectId, repoId);
        }
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
        String branch = resolveBranch(projectId, repo, ref);
        try {
            Path localRepo = projectWorkspaceGitService.resolveRepository(repo).orElseThrow();
            return searchLocalTree(localRepo, keyword.trim(), branch);
        }
        catch (Exception e) {
            log.info("Local repository search unavailable, falling back to provider, projectId={}, repoId={}",
                projectId, repoId);
        }
        return resolveProvider(repo).searchTree(repo.getRepoUrl(), repo.getRepoFullName(), keyword.trim(), branch,
            currentUserToken());
    }

    /** 查询指定仓库的全部远程分支。 */
    public List<ProjectRepoBranchDTO> listBranches(Long repoId) {
        ProjectRepo repo = requireRepo(repoId);
        try {
            Path localRepo = projectWorkspaceGitService.resolveRepository(repo).orElseThrow();
            return listLocalBranches(localRepo, repo.getProjectId());
        }
        catch (Exception e) {
            log.info("Local repository branches unavailable, falling back to provider, repoId={}", repoId);
        }
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
        try {
            Path localRepo = projectWorkspaceGitService.resolveRepository(repo).orElseThrow();
            return getLocalFileContent(localRepo, branch.trim(), normalizedPath);
        }
        catch (Exception e) {
            log.info("Local repository file unavailable, falling back to provider, repoId={}, path={}", repoId,
                normalizedPath);
        }
        return resolveProvider(repo).getFileContent(repo.getRepoUrl(), repo.getRepoFullName(), branch.trim(),
            normalizedPath, currentUserToken());
    }

    /**
     * 查询项目 workspace 仓库中属于指定会话的实际 worktree。
     *
     * @return found 表示是否存在，path 仅在存在且能转换为沙箱路径时返回
     */
    public Map<String, Object> getSessionWorktree(Long projectId, Long sessionId) {
        requireProject(projectId);
        Map<String, Object> result = new HashMap<>();
        result.put("found", false);
        projectWorkspaceGitService.resolveSessionWorktree(projectId, sessionId)
            .flatMap(projectWorkspaceGitService::toSandboxPath)
            .ifPresent(path -> {
                result.put("found", true);
                result.put("path", path);
            });
        return result;
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

    private String resolveBranch(Long projectId, ProjectRepo repo, String ref) {
        if (ref != null && !ref.trim().isEmpty()) {
            return ref.trim();
        }
        return projectId != null ? String.valueOf(projectId)
            : (repo.getDefaultBranch() == null || repo.getDefaultBranch().isBlank() ? "main" : repo.getDefaultBranch());
    }

    private List<ProjectRepoTreeNodeDTO> listLocalTree(Path repoPath, String path, String branch) {
        String treeish = path == null ? branch : branch + ":" + path;
        String output = gitCommandExecutor.executeCommandQuietly(repoPath, "git", "ls-tree", "-l", treeish);
        List<ProjectRepoTreeNodeDTO> nodes = new ArrayList<>();
        for (String line : output.split("\\R")) {
            ProjectRepoTreeNodeDTO node = parseTreeNode(line, path);
            if (node != null) {
                nodes.add(node);
            }
        }
        nodes.sort(Comparator.comparing(ProjectRepoTreeNodeDTO::getType)
            .thenComparing(ProjectRepoTreeNodeDTO::getName, String.CASE_INSENSITIVE_ORDER));
        return nodes;
    }

    private List<ProjectRepoTreeNodeDTO> searchLocalTree(Path repoPath, String keyword, String branch) {
        String output = gitCommandExecutor.executeCommandQuietly(repoPath, "git", "ls-tree", "-r", "-l", branch);
        String normalizedKeyword = keyword.toLowerCase(Locale.ROOT);
        List<ProjectRepoTreeNodeDTO> nodes = new ArrayList<>();
        for (String line : output.split("\\R")) {
            ProjectRepoTreeNodeDTO node = parseTreeNode(line, null);
            if (node != null && node.getPath().toLowerCase(Locale.ROOT).contains(normalizedKeyword)) {
                nodes.add(node);
            }
        }
        nodes.sort(Comparator.comparing(ProjectRepoTreeNodeDTO::getPath, String.CASE_INSENSITIVE_ORDER));
        return nodes;
    }

    private ProjectRepoTreeNodeDTO parseTreeNode(String line, String parentPath) {
        int tab = line.indexOf('\t');
        if (tab < 0) {
            return null;
        }
        String[] metadata = line.substring(0, tab).trim().split("\\s+");
        if (metadata.length < 3) {
            return null;
        }
        String nodePath = line.substring(tab + 1);
        String name = nodePath.substring(nodePath.lastIndexOf('/') + 1);
        ProjectRepoTreeNodeDTO node = new ProjectRepoTreeNodeDTO();
        node.setName(name);
        node.setPath(parentPath == null ? nodePath : parentPath + "/" + nodePath);
        node.setType("tree".equals(metadata[1]) ? "directory" : "file");
        node.setSha(metadata[2]);
        if (metadata.length > 3 && !"-".equals(metadata[3])) {
            try {
                node.setSize(Long.parseLong(metadata[3]));
            }
            catch (NumberFormatException ignored) {
                node.setSize(null);
            }
        }
        node.setHasChildren("directory".equals(node.getType()));
        return node;
    }

    private List<ProjectRepoBranchDTO> listLocalBranches(Path repoPath, Long projectId) {
        String output = gitCommandExecutor.executeCommandQuietly(repoPath, "git", "for-each-ref",
            "--format=%(refname:short)%09%(objectname)", "refs/heads", "refs/remotes/origin");
        Map<String, String> branches = new LinkedHashMap<>();
        for (String line : output.split("\\R")) {
            String[] parts = line.split("\\t", 2);
            if (parts.length != 2 || "origin/HEAD".equals(parts[0])) {
                continue;
            }
            String name = parts[0].startsWith("origin/") ? parts[0].substring("origin/".length()) : parts[0];
            branches.putIfAbsent(name, parts[1]);
        }
        String preferred = String.valueOf(projectId);
        return branches.entrySet().stream()
            .sorted(Map.Entry.<String, String>comparingByKey((left, right) -> {
                if (preferred.equals(left)) return -1;
                if (preferred.equals(right)) return 1;
                return String.CASE_INSENSITIVE_ORDER.compare(left, right);
            }))
            .map(entry -> {
                ProjectRepoBranchDTO branch = new ProjectRepoBranchDTO();
                branch.setName(entry.getKey());
                branch.setSha(entry.getValue());
                branch.setProtectedBranch(false);
                return branch;
            }).toList();
    }

    private ProjectRepoFileContentDTO getLocalFileContent(Path repoPath, String branch, String path) {
        byte[] bytes = gitCommandExecutor.executeCommandBytesQuietly(repoPath, "git", "show", branch + ":" + path);
        boolean binary = isBinary(bytes);
        ProjectRepoFileContentDTO file = new ProjectRepoFileContentDTO();
        file.setName(path.substring(path.lastIndexOf('/') + 1));
        file.setPath(path);
        file.setBranch(branch);
        file.setSize((long) bytes.length);
        file.setBinary(binary);
        if (binary) {
            file.setBase64Content(Base64.getEncoder().encodeToString(bytes));
        }
        else {
            file.setContent(new String(bytes, StandardCharsets.UTF_8));
        }
        return file;
    }

    private boolean isBinary(byte[] bytes) {
        int sampleSize = Math.min(bytes.length, 8000);
        for (int index = 0; index < sampleSize; index++) {
            if (bytes[index] == 0) {
                return true;
            }
        }
        return false;
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
