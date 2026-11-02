package com.iwhalecloud.byai.manager.domain.tenant;

import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatAgentMention;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.*;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class TenantGroupPublicationServiceTest extends I18nTestSupport {
    @Test
    void publicationUsesAuthorizedMemberIdentityWithoutDeserializingNodeIsoDates() throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var events = mock(GroupChatEventPublisher.class);
        var mentions = mock(GroupChatAgentMentionParser.class);
        var service = new TenantGroupPublicationService(data, mock(GroupChatTaskService.class),
            mock(GroupChatPublicationUploader.class), events, mapper);
        ReflectionTestUtils.setField(service, "mentions", mentions);
        var tenant = new TenantRequestContext(57L, 11237409L, "MEMBER");
        Long taskId = 8011237409000004638L;
        String groupId = "2108809138493460480";
        when(data.read(tenant, "group-chat/tasks/" + taskId)).thenReturn(mapper.readTree(
            "{\"groupSessionId\":\"" + groupId + "\",\"targetAgentId\":\"88\",\"status\":\"ACTIVE\",\"turnStatus\":\"WAITING_USER\"}"));
        when(data.read(tenant, "group-chats/" + groupId)).thenReturn(mapper.readTree(
            "{\"members\":[{\"memObjType\":\"AGENT\",\"memObjId\":\"88\",\"memName\":\"expert\",\"createTime\":\"2026-10-10T06:37:33.067Z\",\"lastReadTime\":\"2026-10-10T07:37:33.067Z\"}]}"));
        when(mentions.parseMembers(anyList(), eq(88L), eq("verified result")))
            .thenReturn(new GroupChatAgentMention("verified result", List.of()));
        var result = mapper.readTree("{\"messageId\":\"8011237409000005000\"}");
        when(data.write(eq(tenant), eq("POST"), eq("/tasks/" + taskId + "/publication"), eq(groupId), eq("PUBLISH_TASK"), any()))
            .thenReturn(new TenantNodeModels.CommandResult(groupId, "request", "PUBLISH_TASK", null, List.of(), null, null, result, null));
        var request = new GroupChatTaskCompleteRequest(); request.setText("verified result");
        assertThat(service.complete(tenant, taskId, request)).isSameAs(result);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<ByaiSessionMember>> members = ArgumentCaptor.forClass(List.class);
        verify(mentions).parseMembers(members.capture(), eq(88L), eq("verified result"));
        assertThat(members.getValue()).hasSize(1);
        assertThat(members.getValue().get(0).getMemObjId()).isEqualTo(88L);
        assertThat(members.getValue().get(0).getMemObjType()).isEqualTo("AGENT");
        verify(events, times(2)).publishTenant(eq(tenant), eq(Long.valueOf(groupId)), any());
    }

    @Test
    void pendingPublicationCannotBeOverwrittenInEitherLanguage() {
        var data = mock(TenantGroupData.class);
        var tasks = mock(GroupChatTaskService.class);
        var uploads = mock(GroupChatPublicationUploader.class);
        var events = mock(GroupChatEventPublisher.class);
        var service = new TenantGroupPublicationService(data, tasks, uploads, events, new ObjectMapper());
        var request = new GroupChatTaskCompleteRequest();
        request.setPendingPublicationId(123L);
        request.setText("replacement");
        var tenant = new TenantRequestContext(57L, 11237409L, "MEMBER");
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.complete(tenant, 99L, request))
            .hasMessage("Confirm pending publication without overriding text/files");
        org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.SIMPLIFIED_CHINESE);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.complete(tenant, 99L, request))
            .hasMessage("确认待发布成果时不能覆盖正文或文件");
        verifyNoInteractions(tasks, uploads, events);
        verify(data, never()).write(any(), any(), any(), any(), any(), any());
    }
}
