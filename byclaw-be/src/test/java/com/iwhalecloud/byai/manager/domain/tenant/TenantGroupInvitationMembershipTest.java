package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationTokenRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.InOrder;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.inOrder;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 验证租户邀请接受先准入组织，再加入目标群，失败与重试不能绕过成员关系检查。
 * @author Codex
 * @since 2026-10-30
 */
class TenantGroupInvitationMembershipTest {
    private final TenantGroupData tenantGroupData = mock(TenantGroupData.class);
    private final TenantAdminMemberService tenantAdminMemberService = mock(TenantAdminMemberService.class);
    private final UserService userService = mock(UserService.class);
    private final GroupChatEventPublisher groupChatEventPublisher = mock(GroupChatEventPublisher.class);
    private final AuthApplicationService authApplicationService = mock(AuthApplicationService.class);
    private final TenantRequestContext tenantRequestContext = new TenantRequestContext(77L, 123L, "MEMBER");
    private final ObjectMapper objectMapper = new ObjectMapper();
    private final TenantGroupInvitationService tenantGroupInvitationService = new TenantGroupInvitationService(
        tenantGroupData, userService, authApplicationService, groupChatEventPublisher,
        mock(MessageShareLinkMapper.class), tenantAdminMemberService);

    /** 登录企业与群归属不同，准入仍使用服务端解析出的目标企业。 */
    @BeforeEach
    void prepareInvitation() throws Exception {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(77L);
        loginInfo.setEnterpriseId(456L);
        CurrentUserHolder.setLoginInfo(loginInfo);
        Users activeUser = new Users();
        activeUser.setState("A");
        when(userService.findById(27L)).thenReturn(activeUser);
        when(userService.findById(77L)).thenReturn(activeUser);
        when(tenantGroupData.query(eq(tenantRequestContext), anyString(), any())).thenAnswer(invocation ->
            objectMapper.readTree("{\"groupNumber\":\"9001\",\"inviterId\":\"27\",\"alreadyMember\":false}"));
        when(tenantGroupData.read(tenantRequestContext, "group-chats/9001")).thenAnswer(invocation ->
            objectMapper.readTree("{\"members\":[{\"sessionId\":\"9001\",\"memObjType\":\"USER\",\"memObjId\":\"77\"}]}"));
    }

    /** 请求结束清理共享线程身份。 */
    @AfterEach
    void clearLogin() {
        CurrentUserHolder.clearLoginInfo();
    }

    /** 新成员只有通过组织准入后才允许 Node 写群；不影响其他群。 */
    @Test
    void joiningAdmitsTheTargetEnterpriseBeforeWritingOnlyTheInvitedGroup() {
        JsonNode result = (JsonNode) tenantGroupInvitationService.handle(
            tenantRequestContext, "joinInvitation", invitationArguments());

        InOrder ordered = inOrder(tenantAdminMemberService, tenantGroupData);
        ordered.verify(tenantAdminMemberService).joinByInvitation(123L, 27L);
        ordered.verify(tenantGroupData).write(eq(tenantRequestContext), eq("POST"), eq("/join"),
            eq("9001"), eq("JOIN_GROUP"), any());
        assertThat(result.path("enterpriseId").asText()).isEqualTo("123");
        assertThat(result.path("sessionId").asText()).isEqualTo("9001");
    }

    /** 席位不足、停用关系等组织准入失败时，不写群成员或授权。 */
    @Test
    void rejectedEnterpriseAdmissionDoesNotWriteTheGroup() {
        doThrow(new IllegalArgumentException("tenant.member.disabled"))
            .when(tenantAdminMemberService).joinByInvitation(123L, 27L);

        assertThatThrownBy(() -> tenantGroupInvitationService.handle(
            tenantRequestContext, "joinInvitation", invitationArguments())).hasMessage("tenant.member.disabled");

        verify(tenantGroupData, never()).write(any(), anyString(), anyString(), anyString(), anyString(), any());
        verifyNoInteractions(authApplicationService, groupChatEventPublisher);
    }

    /** Node 已有群关系的重试仍需补齐组织关系，但不能重复写群。 */
    @Test
    void retryWithExistingGroupMembershipStillChecksEnterpriseAdmission() throws Exception {
        when(tenantGroupData.query(eq(tenantRequestContext), anyString(), any())).thenAnswer(invocation ->
            objectMapper.readTree("{\"groupNumber\":\"9001\",\"inviterId\":\"27\",\"alreadyMember\":true}"));

        tenantGroupInvitationService.handle(tenantRequestContext, "joinInvitation", invitationArguments());

        verify(tenantAdminMemberService).joinByInvitation(123L, 27L);
        verify(tenantGroupData, never()).write(any(), anyString(), anyString(), anyString(), anyString(), any());
        verifyNoInteractions(groupChatEventPublisher);
    }

    /** 入群写入失败必须向调用方报错，不能返回组织准入成功作为入群成功。 */
    @Test
    void nodeFailureDoesNotReportSuccessfulJoining() {
        when(tenantGroupData.write(eq(tenantRequestContext), eq("POST"), eq("/join"), eq("9001"),
            eq("JOIN_GROUP"), any())).thenThrow(new IllegalStateException("node unavailable"));

        assertThatThrownBy(() -> tenantGroupInvitationService.handle(
            tenantRequestContext, "joinInvitation", invitationArguments())).hasMessage("node unavailable");

        verify(tenantAdminMemberService).joinByInvitation(123L, 27L);
        verifyNoInteractions(groupChatEventPublisher);
    }

    /** @return 仅携带邀请码的接受命令，不依赖浏览器当前选择的企业。 */
    private Object[] invitationArguments() {
        GroupChatInvitationTokenRequest groupChatInvitationTokenRequest = new GroupChatInvitationTokenRequest();
        groupChatInvitationTokenRequest.setToken("Abcd1234");
        return new Object[] { groupChatInvitationTokenRequest };
    }
}
