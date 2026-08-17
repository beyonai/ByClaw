package com.iwhalecloud.byai.manager.application.service.project;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.nio.file.Path;
import java.util.Collections;
import java.util.List;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.junit.jupiter.api.io.TempDir;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.config.GitWorkspaceConfig;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.project.service.GitCommandExecutor;
import com.iwhalecloud.byai.manager.domain.project.service.ProjectInitAuditService;
import com.iwhalecloud.byai.manager.domain.project.service.RepoLockManager;
import com.iwhalecloud.byai.manager.dto.project.ProjectInitRequest;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;

@ExtendWith(MockitoExtension.class)
class ProjectInitServicePublicPathTest {

    @TempDir
    Path tempDir;

    @Mock
    private GitWorkspaceConfig gitWorkspaceConfig;

    @Mock
    private GitCommandExecutor gitCommandExecutor;

    @Mock
    private ProjectInitAuditService auditService;

    @Mock
    private RepoLockManager repoLockManager;

    @Mock
    private ProjectService projectService;

    @Mock
    private ProjectRepoMapper projectRepoMapper;

    @Mock
    private StringRedisTemplate stringRedisTemplate;

    @Mock
    private ValueOperations<String, String> valueOperations;

    @BeforeEach
    void setCurrentUser() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(88L);
        loginInfo.setUserCode("review-user");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void clonesWorkspaceRepositoryIntoProjectReposDirectory() {
        ProjectInitService service = service();
        Project project = new Project();
        project.setProjectId(1001L);
        ProjectRepo workspaceRepo = new ProjectRepo();
        workspaceRepo.setProjectId(1001L);
        workspaceRepo.setRepoType("workspace");
        workspaceRepo.setRepoFullName("beyonai/ByClaw-Workspace");
        workspaceRepo.setRepoUrl("https://github.com/beyonai/ByClaw-Workspace.git");
        workspaceRepo.setDefaultBranch("main");
        when(projectService.findById(1001L)).thenReturn(project);
        when(projectRepoMapper.selectList(any()))
            .thenReturn(Collections.emptyList(), List.of(workspaceRepo));
        Path projectRepos = tempDir.resolve("projects/1001/repos");
        when(gitWorkspaceConfig.getRoot(1001L)).thenReturn(projectRepos.toString());
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);
        when(valueOperations.get(anyString())).thenReturn("{\"params\":{\"GH_TOKEN\":\"token\"}}");
        when(gitCommandExecutor.isGitRepository(any(Path.class))).thenReturn(true);
        when(repoLockManager.acquireLock(anyString())).thenReturn(true);
        when(gitCommandExecutor.getCurrentBranch(any(Path.class))).thenReturn("main");
        ArgumentCaptor<Path> targetPath = ArgumentCaptor.forClass(Path.class);
        ProjectInitRequest request = new ProjectInitRequest();
        request.setProjectId(1001L);
        request.setAutoCommit(false);
        request.setAutoPush(false);

        service.initProject(request);

        verify(gitCommandExecutor).cloneRepository(anyString(), targetPath.capture(), eq("main"));
        assertThat(targetPath.getValue()).isEqualTo(projectRepos.resolve("ByClaw-Workspace"));
    }

    private ProjectInitService service() {
        ProjectInitService service = new ProjectInitService();
        ReflectionTestUtils.setField(service, "gitWorkspaceConfig", gitWorkspaceConfig);
        ReflectionTestUtils.setField(service, "gitCommandExecutor", gitCommandExecutor);
        ReflectionTestUtils.setField(service, "auditService", auditService);
        ReflectionTestUtils.setField(service, "repoLockManager", repoLockManager);
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
        ReflectionTestUtils.setField(service, "stringRedisTemplate", stringRedisTemplate);
        ReflectionTestUtils.setField(service, "objectMapper", new ObjectMapper());
        return service;
    }
}
