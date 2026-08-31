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

    @Test
    void resolvesOnlyConfiguredRepositoriesThatExistInWorkspaceGitmodules() throws Exception {
        long projectId = 203L;
        ProjectRepo workspace = workspaceRepo(projectId);
        ProjectRepo codeRepo = codeRepo(projectId, 901L, "beyonai/byclaw-test");
        ProjectRepo missingRepo = codeRepo(projectId, 902L, "beyonai/missing");
        Path projectRoot = tempDir.resolve("bucket/by/projects/203");
        Path configuredPath = projectRoot.resolve("repos/workspace");
        Files.createDirectories(projectRoot.resolve(".git"));
        Path submodule = projectRoot.resolve("beyonai/byclaw-test");
        Files.createDirectories(submodule);
        Files.writeString(submodule.resolve(".git"), "gitdir: ../../.git/modules/beyonai/byclaw-test\n");
        Files.writeString(projectRoot.resolve(".gitmodules"), """
            [submodule "beyonai/byclaw-test"]
                path = beyonai/byclaw-test
                url = https://github.com/beyonai/byclaw-test.git
            """);
        ProjectWorkspaceGitService service = service(List.of(workspace, codeRepo, missingRepo), workspace,
            configuredPath);

        List<ProjectWorkspaceGitService.ResolvedRepository> repositories = service.resolveRepositories(projectId);

        assertThat(repositories).extracting(item -> item.repo().getRepoId())
            .containsExactly(workspace.getRepoId(), codeRepo.getRepoId());
        assertThat(repositories.get(1).path()).isEqualTo(submodule);
    }

    @Test
    void resolvesDshRepositoriesDirectlyWhenProjectRootHasNoWorkspaceGitRepository() throws Exception {
        long projectId = 29441L;
        ProjectRepo workspace = workspaceRepo(projectId);
        ProjectRepo codeRepo = codeRepo(projectId, 901L, "beyonai/chat-leads-mvp");
        Path projectRoot = tempDir.resolve("bucket/by/projects/29441");
        Path workspacePath = projectRoot.resolve("repos/workspace");
        Path codePath = projectRoot.resolve("repos/chat-leads-mvp");
        Files.createDirectories(workspacePath.resolve(".git"));
        Files.createDirectories(codePath.resolve(".git"));

        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ProjectInitService initService = mock(ProjectInitService.class);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, codeRepo));
        when(initService.getProjectRepositoryPath(workspace)).thenReturn(workspacePath);
        when(initService.getProjectRepositoryPath(codeRepo)).thenReturn(codePath);
        ProjectWorkspaceGitService service = new ProjectWorkspaceGitService();
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "projectInitService", initService);

        List<ProjectWorkspaceGitService.ResolvedRepository> repositories = service.resolveRepositories(projectId);

        assertThat(repositories).extracting(item -> item.repo().getRepoId())
            .containsExactly(workspace.getRepoId(), codeRepo.getRepoId());
        assertThat(repositories).extracting(ProjectWorkspaceGitService.ResolvedRepository::path)
            .containsExactly(workspacePath, codePath);
    }

    @Test
    void resolvesDshCodeRepositoryWithoutConfiguredWorkspace() throws Exception {
        long projectId = 29441L;
        ProjectRepo codeRepo = codeRepo(projectId, 901L, "beyonai/baiying-h5-lead");
        Path codePath = tempDir.resolve("bucket/by/projects/29441/repos/baiying-h5-lead");
        Files.createDirectories(codePath.resolve(".git"));

        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ProjectInitService initService = mock(ProjectInitService.class);
        when(repoMapper.selectList(any())).thenReturn(List.of(codeRepo));
        when(initService.getProjectRepositoryPath(codeRepo)).thenReturn(codePath);
        ProjectWorkspaceGitService service = new ProjectWorkspaceGitService();
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "projectInitService", initService);

        assertThat(service.resolveRepositories(projectId)).extracting(item -> item.path())
            .containsExactly(codePath);
    }

    private ProjectWorkspaceGitService service(ProjectRepo workspace, Path repository) {
        return service(List.of(workspace), workspace, repository);
    }

    private ProjectWorkspaceGitService service(List<ProjectRepo> repos, ProjectRepo workspace, Path repository) {
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ProjectInitService initService = mock(ProjectInitService.class);
        when(repoMapper.selectList(any())).thenReturn(repos);
        when(initService.getProjectRepositoryPath(workspace)).thenReturn(repository);
        ProjectWorkspaceGitService service = new ProjectWorkspaceGitService();
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "projectInitService", initService);
        return service;
    }

    private ProjectRepo codeRepo(long projectId, long repoId, String fullName) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(repoId);
        repo.setProjectId(projectId);
        repo.setRepoType("code");
        repo.setRepoFullName(fullName);
        repo.setRepoUrl("https://github.com/" + fullName + ".git");
        return repo;
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
