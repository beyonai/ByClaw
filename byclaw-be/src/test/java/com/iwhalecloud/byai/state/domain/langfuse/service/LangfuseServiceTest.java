package com.iwhalecloud.byai.state.domain.langfuse.service;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

class LangfuseServiceTest {

    @Test
    void getTraceTimelineBasicInfoKeepsObservationBranchWhenParentSpanIsMissing() {
        LangfuseService service = new LangfuseService() {
            @Override
            public Map<String, Object> getTraceById(String traceId) {
                Map<String, Object> trace = new HashMap<>();
                trace.put("id", traceId);
                trace.put("input", "user question");
                trace.put("observations", List.of(
                    observation("de6d6f73250f0f38", "client.dispatch", null, "2026-07-14T01:30:57.786Z"),
                    observation("fdd7361158072d17", "openclaw.message.inbound", "c45c1cd01be165ba",
                        "2026-07-14T01:30:57.937Z"),
                    observation("7db7b7b083301d4d", "openclaw.message.processed", "fdd7361158072d17",
                        "2026-07-14T01:30:57.953Z"),
                    observation("8afc1ae8132b0235", "openclaw.harness.run", "7db7b7b083301d4d",
                        "2026-07-14T01:30:59.201Z")));
                return trace;
            }
        };

        Map<String, Object> result = service.getTraceTimelineBasicInfo("trace-1", null);

        List<Map<String, Object>> timeline = timeline(result);
        assertThat(timeline).extracting(item -> item.get("name"))
            .containsExactly("client.dispatch", "openclaw.message.inbound");

        Map<String, Object> inbound = timeline.stream()
            .filter(item -> "openclaw.message.inbound".equals(item.get("name")))
            .findFirst()
            .orElseThrow();
        assertThat(inbound.get("parentId")).isNull();

        List<Map<String, Object>> inboundChildren = timeline(inbound, "children");
        assertThat(inboundChildren).hasSize(1);
        assertThat(inboundChildren.get(0)).containsEntry("name", "openclaw.message.processed")
            .containsEntry("parentId", "fdd7361158072d17");

        List<Map<String, Object>> processedChildren = timeline(inboundChildren.get(0), "children");
        assertThat(processedChildren).hasSize(1);
        assertThat(processedChildren.get(0)).containsEntry("name", "openclaw.harness.run")
            .containsEntry("parentId", "7db7b7b083301d4d");
    }

    private static Map<String, Object> observation(String id, String name, String parentId, String startTime) {
        Map<String, Object> observation = new HashMap<>();
        observation.put("id", id);
        observation.put("type", "SPAN");
        observation.put("name", name);
        observation.put("parentObservationId", parentId);
        observation.put("startTime", startTime);
        observation.put("endTime", startTime);
        observation.put("latency", 0);
        observation.put("metadata", Map.of("debug", true));
        return observation;
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> timeline(Map<String, Object> result) {
        return (List<Map<String, Object>>) result.getOrDefault("timeline", new ArrayList<>());
    }

    @SuppressWarnings("unchecked")
    private static List<Map<String, Object>> timeline(Map<String, Object> result, String key) {
        return (List<Map<String, Object>>) result.getOrDefault(key, new ArrayList<>());
    }
}
