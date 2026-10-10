package com.iwhalecloud.byai.state.domain.chat.dto;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.support.spring.FastJsonHttpMessageConverter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.mock.http.MockHttpOutputMessage;

class RunningChatRecoverySerializationTest {
    private static final long ID = 8011237409000000589L;
    private final ObjectMapper mapper = new ObjectMapper();

    @Test
    void mvcConverterPreservesRecoveryIdsAsStrings() throws Exception {
        var status = new RunningChatInfo();
        status.setSessionId(ID);
        status.setModelAnswerMessageId(ID + 1);
        var snapshot = new RunningChatSnapshotResponse();
        snapshot.setSessionId(ID);
        snapshot.setMessageId(ID + 1);
        List<HttpMessageConverter<?>> converters = new ArrayList<>();
        new WebMvcConfiguration().extendMessageConverters(converters);
        var converter = (FastJsonHttpMessageConverter) converters.getFirst();
        for (Object dto : List.of(status, snapshot)) {
            var output = new MockHttpOutputMessage();
            converter.write(ResponseUtil.successResponse(dto), MediaType.APPLICATION_JSON, output);
            var data = JSON.parseObject(output.getBodyAsString()).getJSONObject("data");
            assertThat(data.get("sessionId")).isEqualTo(Long.toString(ID));
            assertThat(data.get(dto == status ? "modelAnswerMessageId" : "messageId"))
                .isEqualTo(Long.toString(ID + 1));
        }
    }

    @Test
    void runningStatusPreservesLargeIdentitiesAsStringsAndKeepsCountersNumeric() throws Exception {
        var status = new RunningChatInfo();
        status.setSessionId(ID);
        status.setUserMessageId(ID + 1);
        status.setModelAnswerMessageId(ID + 2);
        status.setTaskId(ID + 3);
        status.setAgentId(ID + 4);
        status.setActiveAgentCount(2L);
        status.setStartedAt(1791616177174L);
        var json = mapper.readTree(mapper.writeValueAsString(status));
        assertThat(json.get("sessionId").textValue()).isEqualTo(Long.toString(ID));
        assertThat(json.get("userMessageId").textValue()).isEqualTo(Long.toString(ID + 1));
        assertThat(json.get("modelAnswerMessageId").textValue()).isEqualTo(Long.toString(ID + 2));
        assertThat(json.get("taskId").textValue()).isEqualTo(Long.toString(ID + 3));
        assertThat(json.get("agentId").textValue()).isEqualTo(Long.toString(ID + 4));
        assertThat(json.get("activeAgentCount").isNumber()).isTrue();
        assertThat(json.get("startedAt").isNumber()).isTrue();
    }

    @Test
    void runningSnapshotPreservesInheritedMessageIdentitiesAsStrings() throws Exception {
        var snapshot = new RunningChatSnapshotResponse();
        snapshot.setSessionId(ID);
        snapshot.setMessageId(ID + 1);
        snapshot.setModelAnswerMessageId(ID + 1);
        snapshot.setCreatorId(ID + 2);
        snapshot.setTaskId(ID + 3);
        snapshot.setProjectId(ID + 4);
        snapshot.setRunning(true);
        var json = mapper.readTree(mapper.writeValueAsString(snapshot));
        assertThat(json.get("sessionId").textValue()).isEqualTo(Long.toString(ID));
        assertThat(json.get("messageId").textValue()).isEqualTo(Long.toString(ID + 1));
        assertThat(json.get("modelAnswerMessageId").textValue()).isEqualTo(Long.toString(ID + 1));
        assertThat(json.get("creatorId").textValue()).isEqualTo(Long.toString(ID + 2));
        assertThat(json.get("taskId").textValue()).isEqualTo(Long.toString(ID + 3));
        assertThat(json.get("projectId").textValue()).isEqualTo(Long.toString(ID + 4));
        assertThat(json.get("running").isBoolean()).isTrue();
    }
}
