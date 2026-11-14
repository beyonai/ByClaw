package com.iwhalecloud.byai.state.domain.groupchat;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.groupchat.application.HumanTaskDirectSubmissionService;
import com.iwhalecloud.byai.state.domain.groupchat.humantask.HumanTaskService;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockMultipartFile;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;

class HumanTaskDirectSubmissionServiceTest {
    @Test
    void rejectsEmptyContentAndNeverCreatesAnUploadRequest() {
        var human = mock(HumanTaskService.class);
        var service = new HumanTaskDirectSubmissionService(human, null, null, null, null, null);
        assertThatThrownBy(() -> service.submit(1L, "request-1", "  ", null))
            .hasMessage("HUMAN_TASK_EMPTY_SUBMISSION");
        verifyNoInteractions(human);
    }
    @Test
    void textOnlySubmissionDoesNotRequireCloudOrExecutionSession() throws Exception {
        var human = mock(HumanTaskService.class);
        when(human.task(1L)).thenReturn(JSONObject.parseObject("{\"status\":\"PENDING\"}"));
        when(human.submit(eq(1L), any())).thenAnswer(inv -> inv.getArgument(1));
        var service = new HumanTaskDirectSubmissionService(human, null, null, null, null, null);
        var result = service.submit(1L, "request-1", " done ", null);
        assertThat(result.getString("text")).isEqualTo("done");
        assertThat(result.getJSONArray("files")).isEmpty();
        assertThat(result.getString("sourceType")).isEqualTo("DIRECT");
    }
    @Test
    void sameRequestWithChangedBytesCannotReplayAnOldSubmission() {
        var human = mock(HumanTaskService.class);
        when(human.request(1L, "direct:same")).thenReturn(JSONObject.parseObject("{\"payloadHash\":\"old-hash\"}"));
        var service = new HumanTaskDirectSubmissionService(human, null, null, null, null, null);
        var file = new MockMultipartFile("files", "report.txt", "text/plain", "new bytes".getBytes());
        assertThatThrownBy(() -> service.submit(1L, "same", "", new MockMultipartFile[]{file}))
            .hasMessage("HUMAN_TASK_IDEMPOTENCY_CONFLICT");
        verify(human, never()).submit(anyLong(), any());
    }
}
