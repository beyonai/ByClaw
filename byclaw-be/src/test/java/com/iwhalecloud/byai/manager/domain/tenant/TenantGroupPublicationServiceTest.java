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
    void privateConfirmationReplaysOnlyTheRequestedCardEvenAfterTheNextCardExists() throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var events = mock(GroupChatEventPublisher.class);
        var service = new TenantGroupPublicationService(data, mock(GroupChatTaskService.class),
            mock(GroupChatPublicationUploader.class), events, mapper);
        var tenant = new TenantRequestContext(57L, 11237409L, "MEMBER");
        when(data.read(tenant, "group-chat/tasks/81")).thenReturn(mapper.readTree(
            "{\"groupSessionId\":\"30\",\"status\":\"PRIVATE\"}"));
        var receipt = mapper.readTree("{\"taskId\":\"81\",\"messageId\":\"61\",\"pendingPublicationId\":\"51\"}");
        var request = new GroupChatTaskCompleteRequest();
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> service.complete(tenant, 81L, request))
            .isInstanceOf(IllegalArgumentException.class);
        request.setPendingPublicationId(51L);
        when(data.read(tenant, "group-chat/tasks/81/publication?pendingPublicationId=51")).thenReturn(receipt);
        assertThat(service.complete(tenant, 81L, request)).isEqualTo(receipt);
        verify(data, never()).read(tenant, "group-chat/tasks/81/pending-publication");
        verifyNoInteractions(events);
    }

    @Test
    void publishesOnlyTheGroupMessageForANewPrivateReceiptAndRecoversConcurrentConfirmation() throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var events = mock(GroupChatEventPublisher.class);
        var service = new TenantGroupPublicationService(data, mock(GroupChatTaskService.class),
            mock(GroupChatPublicationUploader.class), events, mapper);
        var mentions = mock(GroupChatAgentMentionParser.class);
        ReflectionTestUtils.setField(service, "mentions", mentions);
        var broadcaster = mock(com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService.class);
        ReflectionTestUtils.setField(service, "broadcaster", broadcaster);
        var tenant = new TenantRequestContext(57L, 11237409L, "MEMBER");
        when(data.read(tenant, "group-chat/tasks/81")).thenReturn(mapper.readTree(
            "{\"groupSessionId\":\"30\",\"targetAgentId\":\"88\",\"status\":\"PRIVATE\",\"turnStatus\":\"PRIVATE\"}"));
        when(data.read(tenant, "group-chats/30")).thenReturn(mapper.readTree(
            "{\"members\":[{\"memObjType\":\"AGENT\",\"memObjId\":\"88\"}]}"));
        var result = mapper.readTree("{\"taskId\":\"81\",\"messageId\":\"61\",\"pendingPublicationId\":\"51\",\"newlyPublished\":true}");
        var receipt = result.deepCopy();
        ((com.fasterxml.jackson.databind.node.ObjectNode) receipt).remove("newlyPublished");
        var draft = mapper.readTree("{\"text\":\"成果\",\"sourcePaths\":[],\"pendingPublicationId\":\"51\"}");
        when(data.read(tenant, "group-chat/tasks/81/pending-publication")).thenReturn(draft, mapper.nullNode());
        when(data.read(tenant, "group-chat/tasks/81/publication?pendingPublicationId=51"))
            .thenReturn(mapper.nullNode(), mapper.nullNode(), receipt);
        when(mentions.parseMembers(anyList(), eq(88L), eq("成果")))
            .thenReturn(new GroupChatAgentMention("成果", List.of()));
        when(data.write(eq(tenant), eq("POST"), eq("/tasks/81/publication"), eq("30"), eq("PUBLISH_TASK"), any()))
            .thenReturn(new TenantNodeModels.CommandResult("30", "request", "PUBLISH_TASK", null,
                List.of(), null, null, result, null));
        var request = new GroupChatTaskCompleteRequest();
        request.setPendingPublicationId(51L);
        assertThat(service.complete(tenant, 81L, request)).isEqualTo(receipt);
        assertThat(service.complete(tenant, 81L, request)).isEqualTo(receipt);
        var event = ArgumentCaptor.forClass(com.alibaba.fastjson.JSONObject.class);
        verify(events).publishTenant(eq(tenant), eq(30L), event.capture());
        assertThat(event.getValue()).containsEntry("event", "MESSAGE_CREATED").containsEntry("messageId", "61")
            .doesNotContainKeys("status", "taskId");
        verify(broadcaster).broadcastTenantRawToUser(eq(tenant), event.capture(), isNull());
        assertThat(event.getValue()).containsEntry("event", "TASK_PUBLICATION_CLEARED")
            .containsEntry("pendingPublicationId", "51").doesNotContainKey("content");
    }

    @Test
    void privateFileCheckpointUsesTheSameExactFileIdAsTheConfirmedPublication() throws Exception {
        var mapper = new ObjectMapper();
        var data = mock(TenantGroupData.class);
        var tasks = mock(GroupChatTaskService.class);
        var uploads = mock(GroupChatPublicationUploader.class);
        var service = new TenantGroupPublicationService(data, tasks, uploads, mock(GroupChatEventPublisher.class), mapper);
        var tenant = new TenantRequestContext(57L, 10L, "MEMBER");
        var mentions = mock(GroupChatAgentMentionParser.class);
        ReflectionTestUtils.setField(service, "mentions", mentions);
        when(data.read(tenant, "group-chat/tasks/81")).thenReturn(mapper.readTree(
            "{\"groupSessionId\":\"30\",\"targetAgentId\":\"88\",\"status\":\"PRIVATE\"}"));
        when(data.read(tenant, "group-chats/30")).thenReturn(mapper.readTree("{\"session\":{\"projectId\":7},\"members\":[]}"));
        when(data.read(tenant, "group-chat/tasks/81/pending-publication")).thenReturn(mapper.readTree(
            "{\"pendingPublicationId\":\"51\",\"text\":\"\",\"sourcePaths\":[\"/by/report.pdf\"],\"uploadedFiles\":{}}"));
        when(tasks.tenantProjectCloudResourceId(7L)).thenReturn(12L);
        String path = "/group-task-results/private/51/0/report.pdf";
        var file = new com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskFile();
        file.setFileName("report.pdf");
        file.setFilePath(path);
        file.setFileId(9007199254740993L);
        when(uploads.upload(any(), eq(12L), eq(true), any())).thenAnswer(invocation -> {
            java.util.function.BiConsumer<Long, String> checkpoint = invocation.getArgument(3);
            checkpoint.accept(12L, "{\"/by/report.pdf\":[{\"fileId\":9007199254740993,\"fileName\":\"report.pdf\",\"filePath\":\"" + path + "\"}]}");
            return List.of(file);
        });
        when(mentions.parseMembers(anyList(), eq(88L), eq(""))).thenReturn(new GroupChatAgentMention("", List.of()));
        when(data.write(eq(tenant), eq("POST"), eq("/tasks/81/publication"), eq("30"), eq("PUBLISH_TASK"), any()))
            .thenReturn(new TenantNodeModels.CommandResult("30", "req", "PUBLISH_TASK", null, List.of(), null, null,
                mapper.readTree("{\"messageId\":\"61\",\"newlyPublished\":false}"), null));
        var request = new GroupChatTaskCompleteRequest();
        request.setPendingPublicationId(51L);
        service.complete(tenant, 81L, request);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<java.util.Map<String, Object>> payload = ArgumentCaptor.forClass(java.util.Map.class);
        verify(data).write(eq(tenant), eq("PATCH"), eq("/tasks/81/pending-publication"), eq("30"),
            eq("CHECKPOINT_PUBLICATION"), payload.capture());
        assertThat(mapper.valueToTree(payload.getValue()).at("/uploadedFiles/~1by~1report.pdf/0/fileId").textValue())
            .isEqualTo("9007199254740993");
        verify(data).write(eq(tenant), eq("POST"), eq("/tasks/81/publication"), eq("30"), eq("PUBLISH_TASK"), payload.capture());
        assertThat(mapper.valueToTree(payload.getValue()).at("/files/0/fileId").textValue()).isEqualTo("9007199254740993");
        assertThat(mapper.valueToTree(payload.getValue()).at("/files/0/cloudResourceId").textValue()).isEqualTo("12");
    }

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
