package com.iwhalecloud.byai.state.domain.groupchat.integration;

import java.util.Set;

import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;
import com.iwhalecloud.byai.common.integration.security.InternalServiceSecurityException;
import com.iwhalecloud.byai.state.interfaces.controller.groupchat.WorkgroupIntegrationController;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

class WorkgroupIntegrationControllerTest {
    @Test
    void browserIdentityOrWrongTenantCannotReadAnotherRecipientsFacts() {
        var access = mock(WorkgroupMessageAccessService.class);
        var unread = mock(WorkgroupUnreadService.class);
        var controller = new WorkgroupIntegrationController(access, unread);
        var request = new MockHttpServletRequest();
        request.addHeader("Beyond-Token", "browser-token-is-not-service-auth");
        assertThatThrownBy(() -> controller.member(request, 7, 30, 22)).isInstanceOf(InternalServiceSecurityException.class);
        assertThatThrownBy(() -> controller.messageAccess(request, 7, 30, 40, 22, true))
            .isInstanceOf(InternalServiceSecurityException.class);
        request.setAttribute(InternalServicePrincipal.ATTRIBUTE,
            new InternalServicePrincipal("hacu", "hacu", Set.of("workgroup:read"), Set.of("8"), false));
        assertThatThrownBy(() -> controller.unread(request, 7, 22)).isInstanceOf(InternalServiceSecurityException.class);
        assertThatThrownBy(() -> controller.messageAccess(request, 7, 30, 40, 22, true))
            .isInstanceOf(InternalServiceSecurityException.class);
        verifyNoInteractions(access, unread);
    }

    /** 摘要须显式请求；接收人已失去访问时不返回任何名称和正文。 */
    @Test
    void explicitPreviewKeepsExistingScopeAndDeniedResponsesContainNoContent() {
        var access = mock(WorkgroupMessageAccessService.class);
        var controller = new WorkgroupIntegrationController(access, mock(WorkgroupUnreadService.class));
        var request = new MockHttpServletRequest();
        request.setAttribute(InternalServicePrincipal.ATTRIBUTE,
            new InternalServicePrincipal("hacu", "hacu", Set.of("workgroup:read"), Set.of("7"), false));
        var query = new WorkgroupMessageQuery(7, 30, 40, 22);
        assertThat(controller.messageAccess(request, 7, 30, 40, 22, true).getData())
            .isEqualTo(java.util.Map.of("allowed", false, "mentioned", false));
        var preview = new WorkgroupMessagePreview("研发群", "小刘", "USER", "你好", null, false);
        when(access.preview(query)).thenReturn(preview);
        when(access.mentioned(query)).thenReturn(true);
        assertThat(controller.messageAccess(request, 7, 30, 40, 22, true).getData())
            .isEqualTo(java.util.Map.of("allowed", true, "mentioned", true, "preview", preview));
    }

    @Test
    void deniedAccessDoesNotRevealMentionsAndSuccessfulUnreadUsesAuthorizedScope() {
        var access = mock(WorkgroupMessageAccessService.class);
        var unread = mock(WorkgroupUnreadService.class);
        var controller = new WorkgroupIntegrationController(access, unread);
        var request = new MockHttpServletRequest();
        request.setAttribute(InternalServicePrincipal.ATTRIBUTE,
            new InternalServicePrincipal("hacu", "hacu", Set.of("workgroup:read"), Set.of("7"), false));
        var query = new WorkgroupMessageQuery(7, 30, 40, 22);
        var response = controller.messageAccess(request, 7, 30, 40, 22, false);
        assertThat(response.getData()).isEqualTo(java.util.Map.of("allowed", false, "mentioned", false));
        org.mockito.Mockito.verify(access, org.mockito.Mockito.never()).mentioned(query);
        when(unread.count(22, 7)).thenReturn(87);
        assertThat(controller.unread(request, 7, 22).getData()).isEqualTo(java.util.Map.of("count", 87));
        verify(unread).count(22, 7);
    }
}
