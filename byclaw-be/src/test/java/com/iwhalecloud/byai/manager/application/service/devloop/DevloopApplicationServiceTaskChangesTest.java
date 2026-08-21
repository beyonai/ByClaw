package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.manager.domain.devloop.service.LocalGitChangeService;
import com.iwhalecloud.byai.manager.domain.project.service.ProjectWorkspaceGitService;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class DevloopApplicationServiceTaskChangesTest {

    @TempDir
    Path tempDir;

    @Test
    void readsChangesOnlyFromTheSessionWorktreeRegisteredByWorkspaceRepo() {
        long sessionId = 5001L;
        long projectId = 100L;
        ProjectRepo workspace = workspaceRepo(projectId);
        Path worktree = tempDir.resolve("bucket/by/.sessions/5001/workspace");
        LocalGitChangeService.LocalChangeResult localResult = mock(LocalGitChangeService.LocalChangeResult.class);
        LocalGitChangeService.LocalFileChange file = mock(LocalGitChangeService.LocalFileChange.class);
        when(localResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(localResult.getBaseBranch()).thenReturn("origin/task-5001");
        when(localResult.getHeadBranch()).thenReturn("task-5001");
        when(localResult.getFiles()).thenReturn(List.of(file));
        when(file.getFilename()).thenReturn("src/App.tsx");
        when(file.getStatus()).thenReturn("modified");
        when(file.getAdditions()).thenReturn(2);
        when(file.getDeletions()).thenReturn(1);

        ServiceFixture fixture = fixture(sessionId, projectId, workspace, worktree);
        when(fixture.localGitChangeService.collectChanges(worktree, "main")).thenReturn(localResult);

        ResponseUtil<Map<String, Object>> response = fixture.service.getTaskChanges(sessionId);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("status", "ok").containsEntry("fileCount", 1);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) response.getData().get("files");
        assertThat(files.getFirst()).containsEntry("repoId", workspace.getRepoId())
            .containsEntry("source", "local").containsEntry("filename", "src/App.tsx");
        verify(fixture.localGitChangeService).collectChanges(worktree, "main");
    }

    @Test
    void returnsEmptyChangesWhenSessionHasNoRegisteredWorktree() {
        long sessionId = 5001L;
        long projectId = 100L;
        ServiceFixture fixture = fixture(sessionId, projectId, workspaceRepo(projectId), null);

        ResponseUtil<Map<String, Object>> response = fixture.service.getTaskChanges(sessionId);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("status", "ok").containsEntry("fileCount", 0)
            .containsEntry("files", List.of());
    }

    @Test
    void readsFileDiffFromTheSameSessionWorktree() {
        long sessionId = 5001L;
        long projectId = 100L;
        ProjectRepo workspace = workspaceRepo(projectId);
        Path worktree = tempDir.resolve("bucket/by/.sessions/5001/workspace");
        ServiceFixture fixture = fixture(sessionId, projectId, workspace, worktree);
        LocalGitChangeService.FileDiffResult diff = mock(LocalGitChangeService.FileDiffResult.class);
        when(diff.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(diff.getFilename()).thenReturn("src/App.tsx");
        when(diff.getDiff()).thenReturn("@@ -1 +1 @@");
        when(fixture.localGitChangeService.fileDiff(worktree, "main", "src/App.tsx")).thenReturn(diff);

        ResponseUtil<Map<String, Object>> response = fixture.service.getTaskFileDiff(sessionId,
            workspace.getRepoId(), "src/App.tsx");

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("status", "ok").containsEntry("filename", "src/App.tsx");
        verify(fixture.localGitChangeService).fileDiff(worktree, "main", "src/App.tsx");
    }

    private ServiceFixture fixture(long sessionId, long projectId, ProjectRepo workspace, Path worktree) {
        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        LocalGitChangeService localGitChangeService = mock(LocalGitChangeService.class);
        ProjectWorkspaceGitService workspaceGitService = mock(ProjectWorkspaceGitService.class);
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setProjectId(projectId);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(workspaceGitService.findWorkspaceRepo(projectId)).thenReturn(Optional.ofNullable(workspace));
        when(workspaceGitService.resolveSessionWorktree(projectId, sessionId))
            .thenReturn(Optional.ofNullable(worktree));

        DevloopApplicationService service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "byaiSessionMapper", sessionMapper);
        ReflectionTestUtils.setField(service, "localGitChangeService", localGitChangeService);
        ReflectionTestUtils.setField(service, "projectWorkspaceGitService", workspaceGitService);
        return new ServiceFixture(service, localGitChangeService);
    }

    private ProjectRepo workspaceRepo(long projectId) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(900L);
        repo.setProjectId(projectId);
        repo.setRepoType("workspace");
        repo.setRepoFullName("org/workspace");
        return repo;
    }

    private record ServiceFixture(DevloopApplicationService service,
                                  LocalGitChangeService localGitChangeService) {
    }
}
