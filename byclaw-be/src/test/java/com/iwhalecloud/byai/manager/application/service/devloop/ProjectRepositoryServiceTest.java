package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.devloop.provider.GitRepositoryProvider;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.project.service.GitCommandExecutor;
import com.iwhalecloud.byai.manager.domain.project.service.ProjectWorkspaceGitService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoTreeNodeDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import java.nio.file.Path;
import java.nio.file.Files;
import java.io.IOException;
import java.util.List;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class ProjectRepositoryServiceTest {

    @TempDir
    Path tempDir;

    @Test
    void browsesLocalGitFirstAndUsesConfiguredDefaultBranch() {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandQuietly(localRepo, "git", "ls-tree", "-l", "main"))
            .thenReturn("040000 tree abcdef -\tsrc\n100644 blob 123456 12\tREADME.md\n");

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), null, null);

        assertThat(nodes).extracting(ProjectRepoTreeNodeDTO::getName).containsExactly("src", "README.md");
        assertThat(nodes.getFirst().getType()).isEqualTo("directory");
        verify(fixture.gitCommandExecutor).executeCommandQuietly(localRepo, "git", "ls-tree", "-l", "main");
    }

    @Test
    void treatsGitSubmoduleEntryAsExpandableDirectory() {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandQuietly(localRepo, "git", "ls-tree", "-l", "main"))
            .thenReturn("160000 commit abcdef -\tbeyonai/byclaw-test\n");

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), null, null);

        assertThat(nodes).singleElement().satisfies(node -> {
            assertThat(node.getName()).isEqualTo("byclaw-test");
            assertThat(node.getType()).isEqualTo("directory");
            assertThat(node.getHasChildren()).isTrue();
        });
    }

    @Test
    void listsSubmoduleContentsFromItsGitRepositoryAndKeepsPathPrefix() throws IOException {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Path submodule = localRepo.resolve("beyonai/byclaw-test");
        Files.createDirectories(submodule);
        Files.writeString(submodule.resolve(".git"), "gitdir: ../../.git/modules/beyonai/byclaw-test\n");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandQuietly(submodule, "git", "ls-tree", "-l", "HEAD"))
            .thenReturn("040000 tree abcdef -\tbyclaw-be\n");

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(),
            "beyonai/byclaw-test", null);

        assertThat(nodes).singleElement().satisfies(node -> {
            assertThat(node.getName()).isEqualTo("byclaw-be");
            assertThat(node.getPath()).isEqualTo("beyonai/byclaw-test/byclaw-be");
            assertThat(node.getType()).isEqualTo("directory");
        });
    }

    private Fixture fixture(long projectId, ProjectRepo repo) {
        GitRepositoryProvider provider = mock(GitRepositoryProvider.class);
        when(provider.providerType()).thenReturn("github");
        ProjectRepositoryService service = new ProjectRepositoryService(List.of(provider));
        ProjectService projectService = mock(ProjectService.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ProjectWorkspaceGitService workspaceGitService = mock(ProjectWorkspaceGitService.class);
        GitCommandExecutor gitCommandExecutor = mock(GitCommandExecutor.class);
        Project project = new Project();
        project.setProjectId(projectId);
        when(projectService.findById(projectId)).thenReturn(project);
        when(repoMapper.selectOne(any())).thenReturn(repo);
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "projectWorkspaceGitService", workspaceGitService);
        ReflectionTestUtils.setField(service, "gitCommandExecutor", gitCommandExecutor);
        return new Fixture(service, workspaceGitService, gitCommandExecutor);
    }

    private ProjectRepo repository(long projectId) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(900L);
        repo.setProjectId(projectId);
        repo.setRepoType("workspace");
        repo.setProvider("github");
        repo.setRepoFullName("org/workspace");
        repo.setDefaultBranch("main");
        return repo;
    }

    private record Fixture(ProjectRepositoryService service, ProjectWorkspaceGitService workspaceGitService,
                           GitCommandExecutor gitCommandExecutor) {
    }
}
