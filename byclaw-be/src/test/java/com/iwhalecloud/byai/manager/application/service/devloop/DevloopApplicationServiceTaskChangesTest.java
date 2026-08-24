package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitHubCompareService;
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
import java.nio.file.StandardOpenOption;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

class DevloopApplicationServiceTaskChangesTest {

    @TempDir
    Path storageRoot;

    @Test
    void aggregatesWorkspaceAndActualSubmoduleChangesWithoutTopLevelRepoId() throws Exception {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");
        ProjectRepo backend = repo(301L, projectId, "code", "org/backend");
        backend.setRepoUrl("https://github.com/org/backend.git");
        ProjectRepo frontend = repo(302L, projectId, "code", "org/frontend");
        frontend.setRepoUrl("https://github.com/org/frontend.git");
        ProjectRepo configuredOnly = repo(303L, projectId, "code", "org/configured-only");
        configuredOnly.setRepoUrl("https://github.com/org/configured-only.git");

        Path workspaceDir = storageRoot.resolve("bucket/by/.sessions/5001/workspace");
        Files.createDirectories(workspaceDir);
        Files.writeString(workspaceDir.resolve(".gitmodules"), "[submodule \"frontend\"]\n"
            + "\tpath = apps/frontend\n"
            + "\turl = https://github.com/org/frontend.git\n"
            + "[submodule \"backend\"]\n"
            + "\tpath = services/backend\n"
            + "\turl = https://github.com/org/backend.git\n");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.LocalChangeResult workspaceResult = localResult("workspace.yaml");
        LocalGitChangeService.LocalChangeResult frontendResult = localResult("src/App.tsx");
        LocalGitChangeService.LocalChangeResult backendResult = localResult("src/App.java");
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, backend, frontend, configuredOnly));
        when(taskService.findBySession(sessionId)).thenReturn(null);
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(eq(workspaceDir), eq("main"))).thenReturn(workspaceResult);
        when(localService.collectChanges(eq(workspaceDir.resolve("apps/frontend")), eq("main")))
            .thenReturn(frontendResult);
        when(localService.collectChanges(eq(workspaceDir.resolve("services/backend")), eq("main")))
            .thenReturn(backendResult);

        DevloopApplicationService service = changesService(sessionMapper, itemMapper, repoMapper, taskService,
            loginService, bucketService, localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        assertThat(response.isSuccess()).isTrue();
        assertThat(response.getData()).doesNotContainKey("repoId").containsEntry("fileCount", 3);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) response.getData().get("files");
        assertThat(files).extracting(file -> file.get("repoId")).containsExactly(900L, 302L, 301L);
        verify(localService, never()).collectChanges(
            eq(workspaceDir.resolve("configured-only")), eq("main"));
    }

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
        LocalGitChangeService.LocalFileChange file = mock(LocalGitChangeService.LocalFileChange.class);

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
        when(localResult.getFiles()).thenReturn(List.of(file));
        when(file.getFilename()).thenReturn("src/App.java");
        when(file.getStatus()).thenReturn("modified");
        when(file.getAdditions()).thenReturn(1);
        when(file.getDeletions()).thenReturn(0);

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
        assertThat(response.getData()).containsEntry("source", "local").doesNotContainKeys("repoId", "repoFullName");
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) response.getData().get("files");
        assertThat(files).extracting(fileChange -> fileChange.get("repoId")).containsExactly(900L, 301L);
        verify(localService).collectChanges(eq(workspaceDir), eq("main"));
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

    @Test
    void aggregatesAllProjectRepositoriesWhenWorkspaceRepoIsMissing() {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo backend = repo(301L, projectId, "code", "org/backend");
        ProjectRepo frontend = repo(302L, projectId, "code", "org/frontend");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.LocalChangeResult backendResult = localResult("src/App.java");
        LocalGitChangeService.LocalChangeResult frontendResult = localResult("src/App.tsx");
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(backend, frontend));
        when(taskService.findBySession(sessionId)).thenReturn(null);
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(eq(storageRoot.resolve("bucket/by/.sessions/5001/backend")), eq("main")))
            .thenReturn(backendResult);
        when(localService.collectChanges(eq(storageRoot.resolve("bucket/by/.sessions/5001/frontend")), eq("main")))
            .thenReturn(frontendResult);

        DevloopApplicationService service = changesService(sessionMapper, itemMapper, repoMapper, taskService,
            loginService, bucketService, localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) response.getData().get("files");
        assertThat(files).extracting(file -> file.get("repoId")).containsExactly(301L, 302L);
    }

    @Test
    void fallsBackToConfiguredCodeReposWhenWorkspaceMetadataIsUnavailable() {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");
        ProjectRepo backend = repo(301L, projectId, "code", "org/backend");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        DevloopPatService patService = mock(DevloopPatService.class);
        GitHubCompareService compareService = mock(GitHubCompareService.class);
        LocalGitChangeService.LocalChangeResult unavailable = mock(LocalGitChangeService.LocalChangeResult.class);
        GitHubCompareService.CompareResult workspaceRemote = remoteResult("org/workspace", null);
        GitHubCompareService.CompareResult backendRemote = remoteResult("org/backend", "src/App.java");
        when(unavailable.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.NO_WORKSPACE);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, backend));
        when(taskService.findBySession(sessionId)).thenReturn(null);
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(any(), eq("main"))).thenReturn(unavailable);
        when(patService.getGitHubPat("1")).thenReturn("token");
        when(compareService.compare(eq("org/workspace"), eq("main"), any(), eq("token")))
            .thenReturn(workspaceRemote);
        when(compareService.compare(eq("org/backend"), eq("main"), any(), eq("token")))
            .thenReturn(backendRemote);

        DevloopApplicationService service = changesService(sessionMapper, itemMapper, repoMapper, taskService,
            loginService, bucketService, localService);
        ReflectionTestUtils.setField(service, "patService", patService);
        ReflectionTestUtils.setField(service, "gitHubCompareService", compareService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        assertThat(response.getData()).containsEntry("source", "remote").containsEntry("fileCount", 1);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) response.getData().get("files");
        assertThat(files).hasSize(1);
        assertThat(files.get(0)).containsEntry("repoId", 301L);
        verify(compareService).compare(eq("org/backend"), eq("main"), any(), eq("token"));
    }

    @Test
    void fallsBackToConfiguredCodeReposWhenGitmodulesCannotBeRead() throws Exception {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");
        ProjectRepo backend = repo(301L, projectId, "code", "org/backend");
        Path workspaceDir = storageRoot.resolve("bucket/by/.sessions/5001/workspace");
        Files.createDirectories(workspaceDir);
        Files.write(workspaceDir.resolve(".gitmodules"), new byte[] {(byte) 0xc3, 0x28},
            StandardOpenOption.CREATE);

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        DevloopPatService patService = mock(DevloopPatService.class);
        GitHubCompareService compareService = mock(GitHubCompareService.class);
        LocalGitChangeService.LocalChangeResult unavailable = mock(LocalGitChangeService.LocalChangeResult.class);
        GitHubCompareService.CompareResult workspaceRemote = remoteResult("org/workspace", null);
        GitHubCompareService.CompareResult backendRemote = remoteResult("org/backend", "src/App.java");
        when(unavailable.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.NO_WORKSPACE);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, backend));
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(any(), eq("main"))).thenReturn(unavailable);
        when(patService.getGitHubPat("1")).thenReturn("token");
        when(compareService.compare(eq("org/workspace"), eq("main"), any(), eq("token")))
            .thenReturn(workspaceRemote);
        when(compareService.compare(eq("org/backend"), eq("main"), any(), eq("token")))
            .thenReturn(backendRemote);

        DevloopApplicationService service = changesService(sessionMapper, itemMapper, repoMapper, taskService,
            loginService, bucketService, localService);
        ReflectionTestUtils.setField(service, "patService", patService);
        ReflectionTestUtils.setField(service, "gitHubCompareService", compareService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        assertThat(response.getData()).containsEntry("fileCount", 1);
        verify(compareService).compare(eq("org/backend"), eq("main"), any(), eq("token"));
    }

    @Test
    void marksEachFileSourceWhenLocalAndRemoteChangesAreMixed() throws Exception {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");
        ProjectRepo backend = repo(301L, projectId, "code", "org/backend");
        backend.setRepoUrl("https://github.com/org/backend.git");
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
        DevloopPatService patService = mock(DevloopPatService.class);
        GitHubCompareService compareService = mock(GitHubCompareService.class);
        LocalGitChangeService.LocalChangeResult local = localResult("workspace.yaml");
        LocalGitChangeService.LocalChangeResult unavailable = mock(LocalGitChangeService.LocalChangeResult.class);
        GitHubCompareService.CompareResult backendRemote = remoteResult("org/backend", "src/App.java");
        when(unavailable.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.NO_WORKSPACE);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, backend));
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.collectChanges(eq(workspaceDir), eq("main"))).thenReturn(local);
        when(localService.collectChanges(eq(workspaceDir.resolve("services/backend")), eq("main")))
            .thenReturn(unavailable);
        when(patService.getGitHubPat("1")).thenReturn("token");
        when(compareService.compare(eq("org/backend"), eq("main"), any(), eq("token")))
            .thenReturn(backendRemote);

        DevloopApplicationService service = changesService(sessionMapper, itemMapper, repoMapper, taskService,
            loginService, bucketService, localService);
        ReflectionTestUtils.setField(service, "patService", patService);
        ReflectionTestUtils.setField(service, "gitHubCompareService", compareService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        @SuppressWarnings("unchecked")
        List<Map<String, Object>> files = (List<Map<String, Object>>) response.getData().get("files");
        assertThat(files).extracting(file -> file.get("source")).containsExactly("local", "remote");
    }

    @Test
    void returnsNoRepoWhenProjectHasNoRepositories() {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        ScanItemTaskService taskService = mock(ScanItemTaskService.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        when(repoMapper.selectList(any())).thenReturn(List.of());

        DevloopApplicationService service = changesService(sessionMapper, itemMapper, repoMapper, taskService,
            loginService, bucketService, localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskChanges(sessionId);

        assertThat(response.getData()).containsEntry("status", "no_repo").containsEntry("fileCount", 0);
    }

    @Test
    void readsFileDiffFromWorkspaceSubmoduleSelectedByRepoId() throws Exception {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");
        ProjectRepo code = repo(301L, projectId, "code", "org/backend");
        code.setRepoUrl("https://github.com/org/backend.git");

        Path workspaceDir = storageRoot.resolve("bucket/by/.sessions/5001/workspace");
        Files.createDirectories(workspaceDir);
        Files.writeString(workspaceDir.resolve(".gitmodules"), "[submodule \"backend\"]\n"
            + "\tpath = services/backend\n"
            + "\turl = https://github.com/org/backend.git\n");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.FileDiffResult diffResult = mock(LocalGitChangeService.FileDiffResult.class);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(repoMapper.selectById(code.getRepoId())).thenReturn(code);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace, code));
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.fileDiff(any(), any(), any())).thenReturn(diffResult);
        when(diffResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(diffResult.getFilename()).thenReturn("src/App.java");

        DevloopApplicationService service = fileDiffService(sessionMapper, repoMapper, loginService, bucketService,
            localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskFileDiff(sessionId, code.getRepoId(),
            "src/App.java");

        assertThat(response.isSuccess()).isTrue();
        verify(localService).fileDiff(eq(workspaceDir.resolve("services/backend")), eq("main"), eq("src/App.java"));
    }

    @Test
    void readsFileDiffFromWorkspaceRepositorySelectedByRepoId() {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.FileDiffResult diffResult = mock(LocalGitChangeService.FileDiffResult.class);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(repoMapper.selectById(workspace.getRepoId())).thenReturn(workspace);
        when(repoMapper.selectList(any())).thenReturn(List.of(workspace));
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.fileDiff(any(), any(), any())).thenReturn(diffResult);
        when(diffResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(diffResult.getFilename()).thenReturn("workspace.yaml");

        DevloopApplicationService service = fileDiffService(sessionMapper, repoMapper, loginService, bucketService,
            localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskFileDiff(sessionId, workspace.getRepoId(),
            "workspace.yaml");

        assertThat(response.isSuccess()).isTrue();
        verify(localService).fileDiff(eq(storageRoot.resolve("bucket/by/.sessions/5001/workspace")), eq("main"),
            eq("workspace.yaml"));
    }

    @Test
    void readsFileDiffFromTopLevelCodeRepoWhenWorkspaceRepoIsMissing() {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo code = repo(301L, projectId, "code", "org/backend");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.FileDiffResult diffResult = mock(LocalGitChangeService.FileDiffResult.class);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(repoMapper.selectById(code.getRepoId())).thenReturn(code);
        when(repoMapper.selectList(any())).thenReturn(List.of(code));
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.fileDiff(any(), any(), any())).thenReturn(diffResult);
        when(diffResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(diffResult.getFilename()).thenReturn("src/App.java");

        DevloopApplicationService service = fileDiffService(sessionMapper, repoMapper, loginService, bucketService,
            localService);

        ResponseUtil<Map<String, Object>> response = service.getTaskFileDiff(sessionId, code.getRepoId(),
            "src/App.java");

        assertThat(response.isSuccess()).isTrue();
        verify(localService).fileDiff(eq(storageRoot.resolve("bucket/by/.sessions/5001/backend")), eq("main"),
            eq("src/App.java"));
    }

    @Test
    void resolvesTaskCodeRepoWhenFileDiffRepoIdIsMissing() throws Exception {
        long sessionId = 5001L;
        long projectId = 100L;
        ByaiSession session = session(sessionId, projectId);
        ProjectRepo code = repo(301L, projectId, "code", "org/backend");
        code.setRepoUrl("https://github.com/org/backend.git");
        ProjectRepo workspace = repo(900L, projectId, "workspace", "org/workspace");

        Path workspaceDir = storageRoot.resolve("bucket/by/.sessions/5001/workspace");
        Files.createDirectories(workspaceDir);
        Files.writeString(workspaceDir.resolve(".gitmodules"), "[submodule \"backend\"]\n"
            + "\tpath = services/backend\n"
            + "\turl = https://github.com/org/backend.git\n");

        ByaiSessionMapper sessionMapper = mock(ByaiSessionMapper.class);
        ScanRequireItemMapper itemMapper = mock(ScanRequireItemMapper.class);
        ProjectRepoMapper repoMapper = mock(ProjectRepoMapper.class);
        LoginApplicationService loginService = mock(LoginApplicationService.class);
        UserBucketNamingService bucketService = mock(UserBucketNamingService.class);
        LocalGitChangeService localService = mock(LocalGitChangeService.class);
        LocalGitChangeService.FileDiffResult diffResult = mock(LocalGitChangeService.FileDiffResult.class);
        when(sessionMapper.selectById(sessionId)).thenReturn(session);
        when(itemMapper.selectOne(any())).thenReturn(null);
        // resolveTaskRepo 沿用旧逻辑取项目首个仓库，同时项目仓库列表仍用于识别 workspace。
        when(repoMapper.selectList(any())).thenReturn(List.of(code, workspace));
        when(loginService.getLoginInfo(1L)).thenReturn(owner());
        when(bucketService.buildUserBucketName("owner")).thenReturn("bucket");
        when(localService.fileDiff(any(), any(), any())).thenReturn(diffResult);
        when(diffResult.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(diffResult.getFilename()).thenReturn("src/App.java");

        DevloopApplicationService service = fileDiffService(sessionMapper, repoMapper, loginService, bucketService,
            localService);
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", itemMapper);

        ResponseUtil<Map<String, Object>> response = service.getTaskFileDiff(sessionId, null, "src/App.java");

        assertThat(response.isSuccess()).isTrue();
        verify(localService).fileDiff(eq(workspaceDir.resolve("services/backend")), eq("main"), eq("src/App.java"));
    }

    private DevloopApplicationService fileDiffService(ByaiSessionMapper sessionMapper, ProjectRepoMapper repoMapper,
        LoginApplicationService loginService, UserBucketNamingService bucketService,
        LocalGitChangeService localService) {
        DevloopApplicationService service = new DevloopApplicationService();
        ReflectionTestUtils.setField(service, "fileStorageRoot", storageRoot.toString());
        ReflectionTestUtils.setField(service, "byaiSessionMapper", sessionMapper);
        ReflectionTestUtils.setField(service, "projectRepoMapper", repoMapper);
        ReflectionTestUtils.setField(service, "loginApplicationService", loginService);
        ReflectionTestUtils.setField(service, "userBucketNamingService", bucketService);
        ReflectionTestUtils.setField(service, "localGitChangeService", localService);
        return service;
    }

    private DevloopApplicationService changesService(ByaiSessionMapper sessionMapper,
        ScanRequireItemMapper itemMapper, ProjectRepoMapper repoMapper, ScanItemTaskService taskService,
        LoginApplicationService loginService, UserBucketNamingService bucketService,
        LocalGitChangeService localService) {
        DevloopApplicationService service = fileDiffService(sessionMapper, repoMapper, loginService, bucketService,
            localService);
        ReflectionTestUtils.setField(service, "scanRequireItemMapper", itemMapper);
        ReflectionTestUtils.setField(service, "scanItemTaskService", taskService);
        return service;
    }

    private static LocalGitChangeService.LocalChangeResult localResult(String filename) {
        LocalGitChangeService.LocalChangeResult result = mock(LocalGitChangeService.LocalChangeResult.class);
        LocalGitChangeService.LocalFileChange file = mock(LocalGitChangeService.LocalFileChange.class);
        when(result.getStatus()).thenReturn(LocalGitChangeService.LocalStatus.OK);
        when(result.getBaseBranch()).thenReturn("main");
        when(result.getHeadBranch()).thenReturn("feat/task-5001");
        when(result.getFiles()).thenReturn(List.of(file));
        when(file.getFilename()).thenReturn(filename);
        when(file.getStatus()).thenReturn("modified");
        when(file.getAdditions()).thenReturn(1);
        when(file.getDeletions()).thenReturn(0);
        return result;
    }

    private static GitHubCompareService.CompareResult remoteResult(String repoFullName, String filename) {
        GitHubCompareService.CompareResult result = mock(GitHubCompareService.CompareResult.class);
        List<GitHubCompareService.FileChange> files = filename == null ? List.of() : List.of(remoteFile(filename));
        when(result.getStatus()).thenReturn(GitHubCompareService.CompareStatus.OK);
        when(result.getRepoFullName()).thenReturn(repoFullName);
        when(result.getBaseBranch()).thenReturn("main");
        when(result.getHeadBranch()).thenReturn("feat/task-5001");
        when(result.getFiles()).thenReturn(files);
        return result;
    }

    private static GitHubCompareService.FileChange remoteFile(String filename) {
        GitHubCompareService.FileChange file = mock(GitHubCompareService.FileChange.class);
        when(file.getFilename()).thenReturn(filename);
        when(file.getStatus()).thenReturn("modified");
        when(file.getAdditions()).thenReturn(1);
        when(file.getDeletions()).thenReturn(0);
        return file;
    }

    private static ByaiSession session(long sessionId, long projectId) {
        ByaiSession session = new ByaiSession();
        session.setSessionId(sessionId);
        session.setProjectId(projectId);
        session.setCreatorId(1L);
        return session;
    }

    private static LoginInfo owner() {
        LoginInfo owner = new LoginInfo();
        owner.setUserCode("owner");
        return owner;
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
