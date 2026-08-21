package com.iwhalecloud.byai.manager.application.service.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;

import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;

class ProjectWorkspaceManifestServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void buildsEnvironmentAndSubmoduleEntriesInRepositoryOrder() {
        ProjectRepo workspace = repo(1L, "beyonai/byclaw-workspace", "https://example.com/workspace.git",
            "main", "workspace");
        ProjectRepo backend = repo(2L, "beyonai/byclaw-be", "https://example.com/backend.git", "develop", "code");

        String manifest = ProjectWorkspaceManifestService.buildGitmodules(List.of(workspace, backend));

        assertThat(manifest).isEqualTo("[environment]\n"
            + "url = https://example.com/workspace.git\n"
            + "branch = main\n\n"
            + "[submodule \"beyonai/byclaw-be\"]\n"
            + "\tpath = beyonai/byclaw-be\n"
            + "\turl = https://example.com/backend.git\n"
            + "\tbranch = develop\n");
    }

    @Test
    void rejectsMoreThanOneWorkspaceRepository() {
        ProjectRepo first = repo(1L, "beyonai/workspace-one", "https://example.com/one.git", "main", "workspace");
        ProjectRepo second = repo(2L, "beyonai/workspace-two", "https://example.com/two.git", "main", "workspace");

        assertThatThrownBy(() -> ProjectWorkspaceManifestService.buildGitmodules(List.of(first, second)))
            .isInstanceOf(IllegalStateException.class);
    }

    @Test
    void writesManifestUnderProjectWorkspaceDirectory() throws Exception {
        ProjectInitService projectInitService = mock(ProjectInitService.class);
        ProjectRepoMapper projectRepoMapper = mock(ProjectRepoMapper.class);
        Path projectDirectory = tempDir.resolve("project");
        Files.createDirectories(projectDirectory);
        when(projectInitService.initProjectWorkspace(1001L)).thenReturn(projectDirectory);
        when(projectRepoMapper.selectList(any())).thenReturn(List.of(
            repo(1L, "beyonai/workspace", "https://example.com/workspace.git", "main", "workspace")));

        ProjectWorkspaceManifestService service = new ProjectWorkspaceManifestService(projectInitService,
            projectRepoMapper);
        service.syncProjectGitmodules(1001L);

        assertThat(Files.readString(projectDirectory.resolve(".gitmodules"))).contains(
            "[environment]", "url = https://example.com/workspace.git", "branch = main");
    }

    private ProjectRepo repo(Long repoId, String fullName, String url, String branch, String repoType) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(repoId);
        repo.setRepoFullName(fullName);
        repo.setRepoUrl(url);
        repo.setDefaultBranch(branch);
        repo.setRepoType(repoType);
        return repo;
    }
}
