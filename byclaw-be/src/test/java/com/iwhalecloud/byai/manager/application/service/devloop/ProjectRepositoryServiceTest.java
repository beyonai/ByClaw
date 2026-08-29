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
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
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
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "main"))
            .thenReturn(gitOutput("040000 tree abcdef -\tsrc", "100644 blob 123456 12\tREADME.md"));

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), null, null);

        assertThat(nodes).extracting(ProjectRepoTreeNodeDTO::getName).containsExactly("src", "README.md");
        assertThat(nodes.getFirst().getType()).isEqualTo("directory");
        verify(fixture.gitCommandExecutor).executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "main");
    }

    @Test
    void includesUntrackedFilesAndKeepsTheirDirectoryHierarchy() {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "main"))
            .thenReturn(gitOutput("100644 blob 123456 12\tREADME.md"));
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-files", "--others", "--exclude-standard", "-z"))
            .thenReturn(gitOutput("scripts/setup.sh", "scripts/nested/run.sh"));

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), null, null);

        assertThat(nodes).extracting(ProjectRepoTreeNodeDTO::getPath)
            .containsExactlyInAnyOrder("README.md", "scripts");
        assertThat(nodes).filteredOn(node -> "scripts".equals(node.getName())).singleElement()
            .satisfies(node -> assertThat(node.getHasChildren()).isTrue());
    }

    @Test
    void keepsLocalUntrackedDirectoryWhenGitTreePathDoesNotExist() {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "main:scripts"))
            .thenThrow(new IllegalStateException("path does not exist in tree"));
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-files", "--others", "--exclude-standard", "-z"))
            .thenReturn(gitOutput("scripts/setup.sh"));

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), "scripts", null);

        assertThat(nodes).singleElement().satisfies(node -> {
            assertThat(node.getName()).isEqualTo("setup.sh");
            assertThat(node.getPath()).isEqualTo("scripts/setup.sh");
            assertThat(node.getType()).isEqualTo("file");
        });
    }

    @Test
    void treatsGitSubmoduleEntryAsExpandableDirectory() {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "main"))
            .thenReturn(gitOutput("160000 commit abcdef -\tbeyonai/byclaw-test"));

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), null, null);

        assertThat(nodes).singleElement().satisfies(node -> {
            assertThat(node.getName()).isEqualTo("byclaw-test");
            assertThat(node.getType()).isEqualTo("directory");
            assertThat(node.getHasChildren()).isTrue();
        });
    }

    @Test
    void keepsUtf8DirectoryNamesInsteadOfGitOctalEscapes() {
        long projectId = 203L;
        ProjectRepo repo = repository(projectId);
        Path localRepo = tempDir.resolve("workspace");
        Fixture fixture = fixture(projectId, repo);
        when(fixture.workspaceGitService.resolveRepository(repo)).thenReturn(Optional.of(localRepo));
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(localRepo, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "main"))
            .thenReturn(gitOutput(
                "040000 tree abcdef -\t成果",
                "040000 tree bcdefa -\t渠道",
                "040000 tree cdefab -\t素材",
                "040000 tree defabc -\t写法",
                "040000 tree efabcd -\t运营"));

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(), null, null);

        assertThat(nodes).extracting(ProjectRepoTreeNodeDTO::getName)
            .containsExactlyInAnyOrder("成果", "渠道", "素材", "写法", "运营");
        assertThat(nodes).allSatisfy(node -> assertThat(node.getName()).doesNotContain("\\"));
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
        when(fixture.gitCommandExecutor.executeCommandBytesQuietly(submodule, "git", "-c", "safe.directory=*",
            "ls-tree", "-l", "-z", "HEAD"))
            .thenReturn(gitOutput("040000 tree abcdef -\tbyclaw-be"));

        List<ProjectRepoTreeNodeDTO> nodes = fixture.service.listTree(projectId, repo.getRepoId(),
            "beyonai/byclaw-test", null);

        assertThat(nodes).singleElement().satisfies(node -> {
            assertThat(node.getName()).isEqualTo("byclaw-be");
            assertThat(node.getPath()).isEqualTo("beyonai/byclaw-test/byclaw-be");
            assertThat(node.getType()).isEqualTo("directory");
        });
    }

    @Test
    void listsOnlyRepositoriesResolvedFromTheWorkspace() {
        long projectId = 203L;
        ProjectRepo workspace = repository(projectId);
        ProjectRepo codeRepo = repository(projectId);
        codeRepo.setRepoId(901L);
        codeRepo.setRepoType("code");
        codeRepo.setRepoFullName("beyonai/byclaw-test");
        Fixture fixture = fixture(projectId, workspace);
        when(fixture.workspaceGitService.resolveRepositories(projectId)).thenReturn(List.of(
            new ProjectWorkspaceGitService.ResolvedRepository(workspace, Path.of("/bucket/by/projects/203")),
            new ProjectWorkspaceGitService.ResolvedRepository(codeRepo,
                Path.of("/bucket/by/projects/203/beyonai/byclaw-test"))));
        when(fixture.workspaceGitService.toSandboxPath(Path.of("/bucket/by/projects/203")))
            .thenReturn(Optional.of("/by/projects/203/"));
        when(fixture.workspaceGitService.toSandboxPath(Path.of("/bucket/by/projects/203/beyonai/byclaw-test")))
            .thenReturn(Optional.of("/by/projects/203/beyonai/byclaw-test/"));

        List<java.util.Map<String, Object>> repositories = fixture.service.listAvailableRepositories(projectId);

        assertThat(repositories).extracting(item -> item.get("repoId"))
            .containsExactly(workspace.getRepoId(), codeRepo.getRepoId());
        assertThat(repositories.get(1)).containsEntry("path", "/by/projects/203/beyonai/byclaw-test/");
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

    private byte[] gitOutput(String... records) {
        return (String.join(String.valueOf('\0'), records) + '\0').getBytes(StandardCharsets.UTF_8);
    }

    private record Fixture(ProjectRepositoryService service, ProjectWorkspaceGitService workspaceGitService,
                           GitCommandExecutor gitCommandExecutor) {
    }
}
