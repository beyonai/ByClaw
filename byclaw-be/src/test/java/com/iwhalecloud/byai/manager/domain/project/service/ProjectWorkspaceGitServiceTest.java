package com.iwhalecloud.byai.manager.domain.project.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.application.service.project.ProjectInitService;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class ProjectWorkspaceGitServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void resolvesProjectWorkspaceRepositoryForSession() throws Exception {
        long projectId = 203L;
        ProjectRepo workspace = workspaceRepo(projectId);
        Path projectRoot = tempDir.resolve("bucket/by/projects/203");
        Path configuredPath = projectRoot.resolve("repos/workspace");
        Files.createDirectories(projectRoot.resolve(".git"));
        ProjectWorkspaceGitService service = service(workspace, configuredPath);

        Path worktree = service.resolveSessionWorktree(projectId, 301L).orElseThrow();

        assertThat(worktree).isEqualTo(projectRoot);
        assertThat(service.toSandboxPath(worktree)).contains("/by/projects/203/");
        assertThat(service.resolveSessionWorktree(projectId, 30L)).contains(projectRoot);
        assertThat(service.resolveSessionWorktree(projectId, null)).isEmpty();
    }

    private ProjectWorkspaceGitService service(ProjectRepo workspace, Path repository) {
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ProjectInitService initService = mock(ProjectInitService.class);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace));
        when(initService.getProjectRepositoryPath(workspace)).thenReturn(repository);
        ProjectWorkspaceGitService service = new ProjectWorkspaceGitService();
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "projectInitService", initService);
        return service;
    }

    private ProjectRepo workspaceRepo(long projectId) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(900L);
        repo.setProjectId(projectId);
        repo.setRepoType("workspace");
        repo.setRepoFullName("org/workspace");
        return repo;
    }
}
