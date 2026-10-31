package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyList;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.quota.SharedQuotaAdmission;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupWorkAssistantService;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupHooks;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

/**
 * 验证租户工作组允许空目标，项目描述及 Node 创建命令保持一致。
 * 创建用户：Codex；创建时间：2026-10-31。
 */
class TenantGroupCreationGoalTest {
    @AfterEach
    void clearLoginInfo() {
        CurrentUserHolder.clearLoginInfo();
    }

    /** 未填写目标时仍创建项目并发送 CREATE_GROUP，Node 会话内容使用空串。 */
    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = { "   ", "\t\n" })
    void createsTenantGroupWithoutGoal(String goal) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10L);
        CurrentUserHolder.setLoginInfo(loginInfo);
        TenantNodeClient tenantNodeClient = mock(TenantNodeClient.class);
        TenantGroupData tenantGroupData = mock(TenantGroupData.class);
        TenantGroupMemberService tenantGroupMemberService = mock(TenantGroupMemberService.class);
        ProjectApplicationService projectApplicationService = mock(ProjectApplicationService.class);
        AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
        GroupWorkAssistantService groupWorkAssistantService = mock(GroupWorkAssistantService.class);
        when(groupWorkAssistantService.resolveDefaultCoordinatorId()).thenReturn(50L);
        when(tenantGroupMemberService.prepareMembers(any(), anyString(), anyList())).thenReturn(List.of());
        when(tenantGroupMemberService.prepareCoordinatorMember(50L))
            .thenReturn(new TenantNodeModels.InvitedMember("AGENT", "50", "Coordinator", true));
        TenantGroupCreationService tenantGroupCreationService = new TenantGroupCreationService(
            tenantNodeClient, tenantGroupData, tenantGroupMemberService, projectApplicationService,
            mock(WorkgroupTemplateService.class), authApplicationService);
        ReflectionTestUtils.setField(tenantGroupCreationService, "groupWorkAssistant", groupWorkAssistantService);
        ReflectionTestUtils.setField(tenantGroupCreationService, "quotaAdmission", mock(SharedQuotaAdmission.class));
        ReflectionTestUtils.setField(tenantGroupCreationService, "workgroupHooks", mock(WorkgroupHooks.class));
        Project project = new Project();
        project.setProjectId(100L);
        project.setProjectName("Optional goal group");
        when(projectApplicationService.createGroupChatProject(any())).thenReturn(project);
        TenantRequestContext tenantRequestContext = new TenantRequestContext(10L, 42L, "OWNER");
        JsonNode groupDetail = new ObjectMapper().createObjectNode();
        when(tenantGroupData.read(eq(tenantRequestContext), anyString())).thenReturn(groupDetail);
        GroupChatCreateRequest groupChatCreateRequest = new GroupChatCreateRequest();
        groupChatCreateRequest.setName("Optional goal group");
        groupChatCreateRequest.setGoal(goal);

        assertThat(tenantGroupCreationService.create(tenantRequestContext, groupChatCreateRequest)).isSameAs(groupDetail);

        ArgumentCaptor<ProjectDTO> projectDtoCaptor = ArgumentCaptor.forClass(ProjectDTO.class);
        verify(projectApplicationService).createGroupChatProject(projectDtoCaptor.capture());
        assertThat(projectDtoCaptor.getValue().getDescription()).isNull();
        ArgumentCaptor<TenantNodeModels.Fields> fieldsCaptor = ArgumentCaptor.forClass(TenantNodeModels.Fields.class);
        verify(tenantNodeClient).command(eq(tenantRequestContext), eq("POST"), eq("/internal/v1/group-chats"),
            anyString(), eq("CREATE_GROUP"), fieldsCaptor.capture(), anyString(), anyList());
        assertThat(fieldsCaptor.getValue().values()).containsEntry("sessionContent", "");
    }
}
