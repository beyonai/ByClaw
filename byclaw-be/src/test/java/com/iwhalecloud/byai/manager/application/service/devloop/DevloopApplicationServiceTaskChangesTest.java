package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.domain.devloop.service.LocalGitChangeService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanItemTaskService;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ScanItemTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ScanRequireItemMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class DevloopApplicationServiceTaskChangesTest {

    @TempDir
    Path storageRoot;

    @Test
    void readsCodeChangesFromWorkspaceSubmodule() throws Exception {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setProjectId(projectId);
        session.setCreatorId(1L);

        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");
        ProjectRepo code = repo(301L, projectId, "code", "org/backend");
        code.setRepoUrl("https://github.com/org/backend.git");
        ScanItemTask task = new ScanItemTask();
        task.setSessionId(sessionId);
        task.setRepoId(code.getRepoId());

        Path workspaceDir = storageRoot.resolve("bucket/by/.sessions/5001/workspace");
        Files.createDirectories(workspaceDir);
        Files.writeString(workspaceDir.resolve(".gitmodules"), "[submodule \"backend\"]\n"
            + "\tpath = services/backend\n"
            + "\turl = https://github.com/org/backend.git\n");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.LocalChangeResult localResult = mock(LocalGitChangeService.LocalChangeResult.class);

        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, code));
        when(repoMapper.selectById(code.getRepoId())).thenReturn(code);
        when(taskService.findBySession(sessionId)).thenReturn(task);
        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner");
        when(loginService.getLoginInfo(1L)).thenReturn(owner);
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(any(), any())).thenReturn(localResult);
        when(localResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(localResult.getBaseBranch()).thenReturn("main");
        when(localResult.getHeadBranch()).thenReturn("feat/task-5001");
        when(localResult.getFiles()).thenReturn(List.of());

        DevloopApplicationService service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "fileStorageRoot", storageRoot.toString());
        ReflectionTestUtils.setField(service, "byaiSessionMapper", sessionMapper);
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", itemMapper);
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "scanItemTaskService", taskService);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginService);
        ReflectionTestUtils.setField(service, "userBucketNamingService", bucketService);
        ReflectionTestUtils.setField(service, "localGitChangeService", localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).containsEntry("source", "local").containsEntry("repoFullName", "org/backend");
        verify(localService).collectChanges(eq(workspaceDir.resolve("services/backend")), eq("main"));
    }

    @Test
    void fallsBackToTopLevelCodeRepoWhenWorkspaceRepoIsMissing() {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setProjectId(projectId);
        session.setCreatorId(1L);
        ProjectRepo code = repo(301L, projectId, "code", "org/backend");
        ScanItemTask task = new ScanItemTask();
        task.setSessionId(sessionId);
        task.setRepoId(code.getRepoId());

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.LocalChangeResult localResult = mock(LocalGitChangeService.LocalChangeResult.class);

        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(code));
        when(taskService.findBySession(sessionId)).thenReturn(task);
        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner");
        when(loginService.getLoginInfo(1L)).thenReturn(owner);
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(any(), any())).thenReturn(localResult);
        when(localResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(localResult.getBaseBranch()).thenReturn("main");
        when(localResult.getHeadBranch()).thenReturn("feat/task-5001");
        when(localResult.getFiles()).thenReturn(List.of());

        DevloopApplicationService service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "fileStorageRoot", storageRoot.toString());
        ReflectionTestUtils.setField(service, "byaiSessionMapper", sessionMapper);
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", itemMapper);
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "scanItemTaskService", taskService);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginService);
        ReflectionTestUtils.setField(service, "userBucketNamingService", bucketService);
        ReflectionTestUtils.setField(service, "localGitChangeService", localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        assertThat(response.isSuccess()).isTrue();
        verify(localService).collectChanges(
            eq(storageRoot.resolve("bucket/by/.sessions/5001/backend")), eq("main"));
    }

    private static ProjectRepo repo(long repoId, long projectId, String repoType, String repoFullName) {
        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(repoId);
        repo.setProjectId(projectId);
        repo.setRepoType(repoType);
        repo.setRepoFullName(repoFullName);
        repo.setDefaultBranch("main");
        return repo;
    }
}
