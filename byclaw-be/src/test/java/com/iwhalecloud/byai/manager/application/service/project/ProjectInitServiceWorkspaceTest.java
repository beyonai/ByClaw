package com.iwhalecloud.byai.manager.application.service.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;
import com.iwhalecloud.byai.manager.config.GitWorkspaceConfig;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;

class ProjectInitServiceWorkspaceTest {

    @TempDir
    Path tempDir;

    @BeforeEach
    void setCurrentUser() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void initializesProjectWorkspaceUnderCurrentUsersBucket() {
        ProjectInitService service = new ProjectInitService();
        ReflectionTestUtils.setField(service, "fileStorageLocalPath", tempDir.toString());
        configureCurrentUserBucket(service);

        Path workspace = service.initProjectWorkspace(1001L);

        assertThat(workspace).isEqualTo(tempDir.resolve("byclaw-user001/by/projects/1001"));
        assertThat(workspace).isDirectory();
    }

    @Test
    void initializesExistingProjectWorkspaceIdempotently() {
        ProjectInitService service = new ProjectInitService();
        ReflectionTestUtils.setField(service, "fileStorageLocalPath", tempDir.toString());
        configureCurrentUserBucket(service);

        Path firstWorkspace = service.initProjectWorkspace(1001L);
        Path secondWorkspace = service.initProjectWorkspace(1001L);

        assertThat(secondWorkspace).isEqualTo(firstWorkspace);
        assertThat(secondWorkspace).isDirectory();
    }

    @Test
    void buildsRepositoryPathFromProjectReposRoot() {
        GitWorkspaceConfig gitWorkspaceConfig = mock(GitWorkspaceConfig.class);
        ProjectInitService service = new ProjectInitService();
        ReflectionTestUtils.setField(service, "gitWorkspaceConfig", gitWorkspaceConfig);
        configureCurrentUserBucket(service);
        Path projectRepos = tempDir.resolve("byclaw-user001/by/projects/1001/repos");
        when(gitWorkspaceConfig.getRoot(1001L, "byclaw-user001")).thenReturn(projectRepos.toString());
        ProjectRepo repo = new ProjectRepo();
        repo.setProjectId(1001L);
        repo.setRepoFullName("beyonai/ByClaw-Workspace");

        Path repositoryPath = ReflectionTestUtils.invokeMethod(service, "buildRepoPath", repo);

        assertThat(repositoryPath).isEqualTo(projectRepos.resolve("ByClaw-Workspace"));
        verify(gitWorkspaceConfig).getRoot(1001L, "byclaw-user001");
    }

    @Test
    void rejectsRepositoryNameThatEscapesProjectReposRoot() {
        GitWorkspaceConfig gitWorkspaceConfig = mock(GitWorkspaceConfig.class);
        ProjectInitService service = new ProjectInitService();
        ReflectionTestUtils.setField(service, "gitWorkspaceConfig", gitWorkspaceConfig);
        configureCurrentUserBucket(service);
        Path projectRepos = tempDir.resolve("byclaw-user001/by/projects/1001/repos");
        when(gitWorkspaceConfig.getRoot(1001L, "byclaw-user001")).thenReturn(projectRepos.toString());
        ProjectRepo repo = new ProjectRepo();
        repo.setProjectId(1001L);
        repo.setRepoFullName("..");

        assertThatThrownBy(() -> ReflectionTestUtils.invokeMethod(service, "buildRepoPath", repo))
            .isInstanceOf(BaseException.class);
    }

    @Test
    void reportsProjectWorkspaceCreationFailure() throws IOException {
        ProjectInitService service = new ProjectInitService();
        ReflectionTestUtils.setField(service, "fileStorageLocalPath", tempDir.toString());
        configureCurrentUserBucket(service);
        Files.createDirectories(tempDir.resolve("byclaw-user001/by"));
        Files.createFile(tempDir.resolve("byclaw-user001/by/projects"));

        assertThatThrownBy(() -> service.initProjectWorkspace(1001L))
            .isInstanceOf(IllegalStateException.class)
            .hasMessageContaining("Failed to create project workspace")
            .hasCauseInstanceOf(IOException.class);
    }

    private void configureCurrentUserBucket(ProjectInitService service) {
        UserBucketNamingService userBucketNamingService = mock(UserBucketNamingService.class);
        when(userBucketNamingService.buildUserBucketName("user001")).thenReturn("byclaw-user001");
        ReflectionTestUtils.setField(service, "userBucketNamingService", userBucketNamingService);
    }
}
