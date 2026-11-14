package com.iwhalecloud.byai.state.domain.groupchat;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.HumanTaskCompletionBridge;
import com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class HumanTaskCompletionBridgeTest {
    @Test
    void unrelatedSessionsKeepTheOriginalPublicationPath() {
        HumanTaskService human = mock(HumanTaskService.class);
        HumanTaskCompletionBridge bridge = new HumanTaskCompletionBridge(human, null, null, null, null, null, null, null);
        assertThat(bridge.complete(42L, new GroupChatTaskCompleteRequest())).isNull();
        verify(human).binding(42L);
    }

    @Test
    void boundSessionsRequireAnExplicitDraftConfirmation() {
        HumanTaskService human = mock(HumanTaskService.class);
        when(human.binding(42L)).thenReturn(JSONObject.parseObject("{\"humanTaskId\":\"7\"}"));
        HumanTaskCompletionBridge bridge = new HumanTaskCompletionBridge(human, null, null, null, null, null, null, null);
        assertThatThrownBy(() -> bridge.complete(42L, new GroupChatTaskCompleteRequest()))
            .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void retriedConsumedDraftReturnsTheSameSubmissionWithoutUploadingAgain() {
        HumanTaskService human = mock(HumanTaskService.class);
        when(human.binding(42L)).thenReturn(JSONObject.parseObject("{\"humanTaskId\":\"7\"}"));
        when(human.request(7L, "session:42:91")).thenReturn(JSONObject.parseObject(
            "{\"result\":{\"humanTaskId\":\"7\",\"submissionId\":\"12\",\"version\":2,\"status\":\"PENDING_REVIEW\"}}"));
        var request = new GroupChatTaskCompleteRequest();
        request.setPendingPublicationId(91L);
        var bridge = new HumanTaskCompletionBridge(human, null, null, null, null, null, null, null);
        var result = bridge.complete(42L, request);
        assertThat(result.getSubmissionId()).isEqualTo(12L);
        assertThat(result.getMessageId()).isNull();
        verify(human, never()).submit(anyLong(), any());
    }
}
