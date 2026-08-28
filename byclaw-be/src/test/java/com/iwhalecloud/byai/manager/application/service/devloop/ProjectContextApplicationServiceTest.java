package com.iwhalecloud.byai.manager.application.service.devloop;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectSessionService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectContextSharedFileDto;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectMemberListDto;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectRepo;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectResourceMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectShareFileMapper;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;
import java.util.Set;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class ProjectContextApplicationServiceTest {

    @Mock
    private ProjectService projectService;
    @Mock
    private ProjectSessionService projectSessionService;
    @Mock
    private ProjectMemberService projectMemberService;
    @Mock
    private ProjectRepoMapper projectRepoMapper;
    @Mock
    private ProjectResourceMapper projectResourceMapper;
    @Mock
    private ProjectShareFileMapper projectShareFileMapper;
    @Mock
    private SsResourceService ssResourceService;

    @BeforeEach
    void setCurrentUser() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(88L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void clearCurrentUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void aggregatesProjectContextAndUsesProjectIdBeforeSessionId() {
        Project project = project(7L, 88L);
        when(projectService.findById(7L)).thenReturn(project);

        ProjectRepo repo = new ProjectRepo();
        repo.setRepoId(71L);
        repo.setRepoFullName("beyonai/byclaw-test");
        repo.setRepoUrl("https://secret-token@github.com/beyonai/byclaw-test.git");
        when(projectRepoMapper.selectList(any())).thenReturn(List.of(repo));

        ProjectResource knowledgeBinding = binding(101L, "knowledge", "历史知识库");
        ProjectResource deletedKnowledgeBinding = binding(99901L, "knowledge", "已删除知识库");
        ProjectResource ontologyBinding = binding(99902L, "ontology", "已删除本体对象");
        when(projectResourceMapper.selectList(any()))
            .thenReturn(List.of(knowledgeBinding, deletedKnowledgeBinding, ontologyBinding));
        SsResource knowledge = new SsResource();
        knowledge.setResourceId(101L);
        knowledge.setResourceName("项目知识库");
        knowledge.setResourceBizType("KG_DOC");
        when(ssResourceService.findByIdList(any())).thenReturn(List.of(knowledge));

        ProjectMemberListDto member = new ProjectMemberListDto();
        member.setUserId(88L);
        member.setUserName("项目负责人");
        member.setUserNumber("0027000001");
        member.setPhone("13800000000");
        member.setRole("owner");
        when(projectMemberService.listProjectMembers(7L, null, 88L)).thenReturn(List.of(member));

        ProjectContextSharedFileDto file = new ProjectContextSharedFileDto();
        file.setFileId(901L);
        file.setFileName("设计说明.md");
        when(projectShareFileMapper.countContextFiles(7L)).thenReturn(2L);
        when(projectShareFileMapper.listContextFiles(eq(7L), anyInt())).thenReturn(List.of(file));

        ProjectContextQueryDto query = new ProjectContextQueryDto();
        query.setProjectId(7L);
        query.setSessionId(99L);
        query.setPageSize(1);

        ProjectContextDto result = service().getProjectContext(query);

        assertThat(result.getResolvedBy()).isEqualTo("projectId");
        assertThat(result.getProject().getProjectName()).isEqualTo("研发项目");
        assertThat(result.getRepositories()).extracting(ProjectContextDto.RepositorySummary::getRepoFullName)
            .containsExactly("beyonai/byclaw-test");
        assertThat(result.getRepositories().getFirst().getRepoUrl())
            .isEqualTo("https://github.com/beyonai/byclaw-test.git");
        assertThat(result.getKnowledgeBases()).extracting(ProjectContextDto.ResourceSummary::getResourceName)
            .containsExactly("项目知识库", "已删除知识库");
        assertThat(result.getOntologies().getOthers()).singleElement().satisfies(item -> {
            assertThat(item.getResourceName()).isEqualTo("已删除本体对象");
            assertThat(item.isAvailable()).isFalse();
        });
        assertThat(result.getMembers()).singleElement().satisfies(item -> {
            assertThat(item.getUserName()).isEqualTo("项目负责人");
            assertThat(item.getUserNumber()).isEqualTo("0027000001");
        });
        assertThat(result.getCounts().get("sharedFiles")).isEqualTo(2L);
        assertThat(result.getTruncated().get("sharedFiles")).isTrue();
        verify(projectSessionService, never()).findProjectIdBySessionId(any());
    }

    @Test
    void resolvesProjectBySessionAndSupportsSectionFiltering() {
        when(projectSessionService.findProjectIdBySessionId(99L)).thenReturn(7L);
        when(projectService.findById(7L)).thenReturn(project(7L, 88L));
        when(projectRepoMapper.selectList(any())).thenReturn(List.of());
        ProjectContextQueryDto query = new ProjectContextQueryDto();
        query.setSessionId(99L);
        query.setSections(Set.of("repositories"));

        ProjectContextDto result = service().getProjectContext(query);

        assertThat(result.getResolvedBy()).isEqualTo("sessionId");
        assertThat(result.getProject()).isNull();
        assertThat(result.getCounts()).containsEntry("repositories", 0L);
        verify(projectResourceMapper, never()).selectList(any());
    }

    @Test
    void rejectsProjectOutsideCurrentUsersVisibility() {
        when(projectService.findById(7L)).thenReturn(project(7L, 99L));
        when(projectMemberService.isMember(7L, 88L)).thenReturn(false);
        ProjectContextQueryDto query = new ProjectContextQueryDto();
        query.setProjectId(7L);

        assertThatThrownBy(() -> service().getProjectContext(query))
            .isInstanceOf(BaseException.class);
    }

    private Project project(Long projectId, Long createBy) {
        Project project = new Project();
        project.setProjectId(projectId);
        project.setProjectName("研发项目");
        project.setProjectType("develop");
        project.setCreateBy(createBy);
        project.setDeleteFlag("0");
        return project;
    }

    private ProjectResource binding(Long resourceId, String resourceType, String resourceName) {
        ProjectResource binding = new ProjectResource();
        binding.setResourceId(resourceId);
        binding.setResourceType(resourceType);
        binding.setResourceName(resourceName);
        binding.setDeleteFlag("0");
        return binding;
    }

    private ProjectContextApplicationService service() {
        ProjectContextApplicationService service = new ProjectContextApplicationService();
        ReflectionTestUtils.setField(service, "projectService", projectService);
        ReflectionTestUtils.setField(service, "projectSessionService", projectSessionService);
        ReflectionTestUtils.setField(service, "projectMemberService", projectMemberService);
        ReflectionTestUtils.setField(service, "projectRepoMapper", projectRepoMapper);
        ReflectionTestUtils.setField(service, "projectResourceMapper", projectResourceMapper);
        ReflectionTestUtils.setField(service, "projectShareFileMapper", projectShareFileMapper);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        return service;
    }
}
