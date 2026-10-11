package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.entity.message.MessageShareLink;
import com.iwhalecloud.byai.manager.mapper.message.MessageShareLinkMapper;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatInvitationTokenRequest;
import org.junit.jupiter.api.Test;

class TenantGroupInvitationServiceTest {
    private final MessageShareLinkMapper links = mock(MessageShareLinkMapper.class);
    private final TenantContextService contexts = mock(TenantContextService.class);
    private final UserService users = mock(UserService.class);
    private final TenantGroupData data = mock(TenantGroupData.class);
    private final TenantGroupInvitationService service = new TenantGroupInvitationService(data,
        users, mock(AuthApplicationService.class), mock(GroupChatEventPublisher.class), links, contexts);

    private Object[] invitation() {
        var request = new GroupChatInvitationTokenRequest();
        request.setToken("Abcd1234");
        return new Object[]{request, mock(jakarta.servlet.http.HttpServletResponse.class)};
    }

    @Test
    void anonymousPreviewLocatesTenantUsingPersistedInvitationOnly() {
        var link = new MessageShareLink();
        link.setComAcctId(10292148L);
        link.setCreatorId(27L);
        link.setStatus("ACTIVE");
        link.setExpireTime(java.time.LocalDateTime.now().plusDays(1));
        when(links.selectInvitationByToken("Abcd1234")).thenReturn(link);
        assertThat(service.resolve("validateInvitation", invitation(), null))
            .isEqualTo(new TenantRequestContext(27L, 10292148L, "MEMBER"));
        verifyNoInteractions(contexts, data);
    }

    @Test
    void joiningRequiresActualLoginMembershipInsteadOfInviterIdentity() {
        var link = new MessageShareLink();
        link.setComAcctId(10292148L);
        link.setCreatorId(27L);
        link.setStatus("ACTIVE");
        link.setExpireTime(java.time.LocalDateTime.now().plusDays(1));
        when(links.selectInvitationByToken("Abcd1234")).thenReturn(link);
        when(contexts.validate("10292148")).thenThrow(new IllegalArgumentException("Login required"));
        assertThatThrownBy(() -> service.resolve("joinInvitation", invitation(), null))
            .hasMessage("Login required");
        verifyNoInteractions(data);
    }

    @Test
    void invitationCreationPersistsTheTokenReturnedByNodeForAnonymousRouting() throws Exception {
        var tenant = new TenantRequestContext(27L, 10292148L, "MEMBER");
        var result = mock(TenantNodeModels.CommandResult.class);
        when(result.data()).thenReturn(new ObjectMapper().readTree(
            "{\"token\":\"Abcd1234\",\"expiresAt\":" + (System.currentTimeMillis() + 86400000) + "}"));
        when(data.write(eq(tenant), eq("POST"), eq("/invitations"), eq("9001"),
            eq("CREATE_INVITATION"), any())).thenReturn(result);
        when(links.insert(any(MessageShareLink.class))).thenReturn(1);
        service.handle(tenant, "createInvitation", new Object[]{9001L,
            mock(jakarta.servlet.http.HttpServletResponse.class)});
        var saved = org.mockito.ArgumentCaptor.forClass(MessageShareLink.class);
        verify(links).insert(saved.capture());
        assertThat(saved.getValue().getLinkToken()).isEqualTo("Abcd1234");
        assertThat(saved.getValue().getComAcctId()).isEqualTo(10292148L);
    }

    @Test
    void anonymousPreviewNeverReportsTheTransportInviterAsTheCurrentMember() throws Exception {
        var tenant = new TenantRequestContext(27L, 10292148L, "MEMBER");
        when(data.query(eq(tenant), anyString(), any())).thenReturn(new ObjectMapper().readTree(
            "{\"inviterId\":\"27\",\"alreadyMember\":true}"));
        var inviter = new com.iwhalecloud.byai.manager.entity.users.Users();
        inviter.setState("A");
        when(users.findById(27L)).thenReturn(inviter);
        var preview = (com.fasterxml.jackson.databind.JsonNode) service.handle(tenant,
            "validateInvitation", invitation());
        assertThat(preview.path("alreadyMember").asBoolean()).isFalse();
        assertThat(preview.has("inviterId")).isFalse();
        assertThat(preview.path("enterpriseId").asText()).isEqualTo("10292148");
    }

    @Test
    void defaultGroupInvitationKeepsLegacyRouting() {
        assertThat(service.resolve("validateInvitation", invitation(), null)).isNull();
        verifyNoInteractions(contexts, data);
    }
}
