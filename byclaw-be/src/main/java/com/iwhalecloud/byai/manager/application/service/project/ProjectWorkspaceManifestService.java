package com.iwhalecloud.byai.manager.application.service.project;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.AtomicMoveNotSupportedException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.StandardCopyOption;
import java.util.List;
import java.util.Objects;
import java.util.stream.Collectors;

import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;

/**
 * Maintains the project-level Git manifest used to describe the workspace and
 * its code repositories.
 *
 * <p>The manifest lives in the project workspace directory. The later Git
 * initialization flow also creates a manifest inside the cloned workspace
 * repository; that copy is intentionally kept because it is the file consumed
 * by Git itself.</p>
 */
@Service
public class ProjectWorkspaceManifestService {

    private static final String REPO_TYPE_WORKSPACE = "workspace";
    private static final String REPO_TYPE_CODE = "code";
    private static final String DEFAULT_BRANCH = "main";
    private static final String MANIFEST_FILE_NAME = ".gitmodules";

    private final ProjectInitService projectInitService;
    private final ProjectRepoMapper projectRepoMapper;

    public ProjectWorkspaceManifestService(ProjectInitService projectInitService, ProjectRepoMapper projectRepoMapper) {
        this.projectInitService = Objects.requireNonNull(projectInitService, "projectInitService");
        this.projectRepoMapper = Objects.requireNonNull(projectRepoMapper, "projectRepoMapper");
    }

    /**
     * Rebuilds the project-level manifest from the persisted repository list.
     *
     * <p>The method is idempotent and writes atomically, so a failed write does
     * not leave a partially-written manifest behind.</p>
     *
     * @param projectId project whose manifest should be synchronized
     */
    public void syncProjectGitmodules(Long projectId) {
        Path projectDirectory = projectInitService.initProjectWorkspace(projectId);
        List<ProjectRepo> repositories = projectRepoMapper.selectList(new LambdaQueryWrapper<ProjectRepo>()
            .eq(ProjectRepo::getProjectId, projectId)
            .orderByAsc(ProjectRepo::getRepoId));
        Path manifestPath = projectDirectory.resolve(MANIFEST_FILE_NAME);
        List<ProjectRepo> workspaceRepositories = repositories.stream()
            .filter(repo -> REPO_TYPE_WORKSPACE.equalsIgnoreCase(StringUtils.trimToEmpty(repo.getRepoType())))
            .collect(Collectors.toList());

        if (workspaceRepositories.isEmpty()) {
            deleteManifestIfPresent(manifestPath);
            return;
        }
        if (workspaceRepositories.size() > 1) {
            throw new IllegalStateException("Project " + projectId + " has more than one workspace repository");
        }

        try {
            writeAtomically(manifestPath, buildGitmodules(repositories));
        }
        catch (IOException e) {
            throw new IllegalStateException("Failed to write project Git manifest: " + manifestPath, e);
        }
    }

    /**
     * Builds the canonical manifest. The first workspace repository becomes
     * the environment section; code repositories become Git submodules in
     * their persisted order.
     */
    static String buildGitmodules(List<ProjectRepo> repositories) {
        List<ProjectRepo> workspaceRepositories = repositories.stream()
            .filter(repo -> REPO_TYPE_WORKSPACE.equalsIgnoreCase(StringUtils.trimToEmpty(repo.getRepoType())))
            .collect(Collectors.toList());
        if (workspaceRepositories.isEmpty()) {
            throw new IllegalArgumentException("A workspace repository is required");
        }
        if (workspaceRepositories.size() > 1) {
            throw new IllegalStateException("A project can have only one workspace repository");
        }
        ProjectRepo workspace = workspaceRepositories.get(0);

        StringBuilder manifest = new StringBuilder();
        appendEnvironment(manifest, workspace);
        repositories.stream()
            .filter(repo -> REPO_TYPE_CODE.equalsIgnoreCase(StringUtils.trimToEmpty(repo.getRepoType())))
            .forEach(repo -> appendSubmodule(manifest, repo));
        return manifest.toString();
    }

    private static void appendEnvironment(StringBuilder manifest, ProjectRepo workspace) {
        manifest.append("[environment]\n")
            .append("url = ").append(repositoryUrl(workspace)).append('\n')
            .append("branch = ").append(repositoryBranch(workspace)).append("\n\n");
    }

    private static void appendSubmodule(StringBuilder manifest, ProjectRepo repository) {
        String path = repositoryPath(repository);
        manifest.append("[submodule \"").append(path).append("\"]\n")
            .append("\tpath = ").append(path).append('\n')
            .append("\turl = ").append(repositoryUrl(repository)).append('\n')
            .append("\tbranch = ").append(repositoryBranch(repository)).append('\n');
    }

    private static String repositoryPath(ProjectRepo repository) {
        String path = StringUtils.trimToEmpty(repository.getRepoFullName()).replace('\\', '/');
        if (path.isEmpty() || Path.of(path).isAbsolute() || Path.of(path).normalize().startsWith("..")) {
            throw new IllegalArgumentException("Invalid submodule path: " + path);
        }
        return path;
    }

    private static String repositoryUrl(ProjectRepo repository) {
        return StringUtils.defaultIfBlank(repository.getRepoUrl(), repository.getRepoFullName()).trim();
    }

    private static String repositoryBranch(ProjectRepo repository) {
        return StringUtils.defaultIfBlank(repository.getDefaultBranch(), DEFAULT_BRANCH).trim();
    }

    private static void writeAtomically(Path manifestPath, String content) throws IOException {
        Path temporaryPath = Files.createTempFile(manifestPath.getParent(), ".gitmodules-", ".tmp");
        try {
            Files.writeString(temporaryPath, content, StandardCharsets.UTF_8);
            try {
                Files.move(temporaryPath, manifestPath, StandardCopyOption.ATOMIC_MOVE,
                    StandardCopyOption.REPLACE_EXISTING);
            }
            catch (AtomicMoveNotSupportedException e) {
                Files.move(temporaryPath, manifestPath, StandardCopyOption.REPLACE_EXISTING);
            }
        }
        finally {
            Files.deleteIfExists(temporaryPath);
        }
    }

    private static void deleteManifestIfPresent(Path manifestPath) {
        try {
            Files.deleteIfExists(manifestPath);
        }
        catch (IOException e) {
            throw new IllegalStateException("Failed to remove project Git manifest: " + manifestPath, e);
        }
    }
}
