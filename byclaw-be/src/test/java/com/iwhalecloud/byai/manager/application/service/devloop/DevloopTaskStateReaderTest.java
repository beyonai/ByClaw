package com.iwhalecloud.byai.manager.application.service.devloop;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.nio.charset.StandardCharsets;
import java.util.function.Supplier;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;

@ExtendWith(MockitoExtension.class)
class DevloopTaskStateReaderTest {

    @Mock
    private UserFS userFS;

    @Mock
    private SandboxUserContextRunner userContextRunner;

    private DevloopTaskStateReader reader;

    @BeforeEach
    void setUp() {
        reader = new DevloopTaskStateReader(userFS, userContextRunner, new ObjectMapper());
    }

    @Test
    void readsSessionProjectionDirectlyBySessionId() {
        when(userContextRunner.callAsUser(eq("owner-code"), any())).thenAnswer(invocation -> {
            Supplier<?> supplier = invocation.getArgument(1);
            return supplier.get();
        });
        String json = """
            {
              "schema_version": "2.0.0",
              "revision": 7,
              "session_id": "123",
              "trace_id": "019f826e-d02b-7928-82e9-f19ab2901a86",
              "title": "实现任务状态查询",
              "status": "in_progress",
              "status_label": "进行中",
              "current_stage": {
                "stage_id": "backend_update",
                "stage_index": 1,
                "stage_name": "后端实现",
                "skill": "test-driven-development",
                "activity": "编写读取器",
                "next_action": "运行测试"
              },
              "progress": {
                "percent": 40,
                "completed_stages": 0,
                "total_stages": 3,
                "summary": "后端实现中"
              },
              "loop_count": 1,
              "stage_loop_count": 2,
              "stages": [{
                "stage_id": "backend_update",
                "sequence": 1,
                "stage_name": "后端实现",
                "skill": "test-driven-development",
                "status": "in_progress",
                "status_label": "进行中",
                "activity": "编写读取器",
                "progress_percent": 40,
                "loop_count": 2
              }],
              "transitions": [],
              "pause": null,
              "state_file": "runs/019f826e-d02b-7928-82e9-f19ab2901a86/state.json",
              "created_at": "2026-07-21T02:00:00Z",
              "updated_at": "2026-07-21T02:10:00Z"
            }
            """;
        when(userFS.read("/by/.acp-runs/sessions/123.json"))
            .thenReturn(new ByteArrayInputStream(json.getBytes(StandardCharsets.UTF_8)));

        DevloopTaskStateDto state = reader.read("owner-code", 123L);

        assertThat(state.getSchemaVersion()).isEqualTo("2.0.0");
        assertThat(state.getRevision()).isEqualTo(7);
        assertThat(state.getTraceId()).isEqualTo("019f826e-d02b-7928-82e9-f19ab2901a86");
        assertThat(state.getCurrentStage().getStageName()).isEqualTo("后端实现");
        assertThat(state.getProgress().getPercent()).isEqualTo(40);
        assertThat(state.getLoopCount()).as("完整任务流程循环数").isEqualTo(1);
        assertThat(state.getStageLoopCount()).as("当前具体环节循环数").isEqualTo(2);
        assertThat(state.getStages()).singleElement().satisfies(stage -> {
            assertThat(stage.getStageId()).isEqualTo("backend_update");
            assertThat(stage.getStatus()).isEqualTo("in_progress");
            assertThat(stage.getLoopCount()).as("该环节自身累计循环数").isEqualTo(2);
        });
        verify(userFS).read("/by/.acp-runs/sessions/123.json");
    }

    @Test
    void serializesApiResponseWithCamelCaseFieldNames() throws Exception {
        DevloopTaskStateDto state = new DevloopTaskStateDto();
        state.setSchemaVersion("2.0.0");
        state.setTraceId("trace-1");

        String json = new ObjectMapper().writeValueAsString(state);

        assertThat(json).contains("\"schemaVersion\":\"2.0.0\"");
        assertThat(json).contains("\"traceId\":\"trace-1\"");
        assertThat(json).doesNotContain("schema_version", "trace_id");
    }
}
