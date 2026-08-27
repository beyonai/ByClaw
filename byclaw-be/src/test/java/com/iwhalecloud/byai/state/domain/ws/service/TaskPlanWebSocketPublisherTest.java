package com.iwhalecloud.byai.state.domain.ws.service;

import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSONObject;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.taskplan.dto.TaskPlanSnapshot;

class TaskPlanWebSocketPublisherTest {

    @Test
    void frame_usesDedicatedMessageTypeAndCompleteSnapshot() {
        TaskPlanWebSocketPublisher publisher = new TaskPlanWebSocketPublisher(
            mock(MultiDeviceBroadcastService.class), new ObjectMapper());
        TaskPlanSnapshot snapshot = new TaskPlanSnapshot();
        snapshot.setPlanId("plan-1");
        snapshot.setVersion(3);
        snapshot.setTitle("分析代码");
        snapshot.setStatus("ACTIVE");
        snapshot.setSessionId("session-1");
        snapshot.setMessageId("message-1");
        snapshot.setCreatedAt(new Date(0));

        JSONObject frame = publisher.frame(snapshot, "request-1");

        assertThat(frame.getString("type")).isEqualTo("TASK_PLAN_SNAPSHOT");
        assertThat(frame.getString("schemaVersion")).isEqualTo("byclaw.task-plan/v1");
        assertThat(frame.getString("sessionId")).isEqualTo("session-1");
        assertThat(frame.getJSONObject("data").getString("planId")).isEqualTo("plan-1");
        assertThat(frame.getJSONObject("data").getInteger("version")).isEqualTo(3);
        assertThat(frame.getJSONObject("data").getString("createdAt"))
            .isEqualTo("1970-01-01T08:00:00.000+08:00");
    }
}
