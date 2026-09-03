package com.iwhalecloud.byai.state.infrastructure.utils;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.HashMap;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;

import com.iwhaleai.byai.framework.core.protocol.ActionType;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.chat.dto.RunningChatInfo;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

class ResumeRoutingTraceLoggerTest {

    private Logger logger;
    private ListAppender<ILoggingEvent> appender;

    @BeforeEach
    void setUp() {
        logger = (Logger)LoggerFactory.getLogger(ResumeRoutingTraceLogger.class);
        appender = new ListAppender<>();
        logger.addAppender(appender);
        appender.start();
    }

    @AfterEach
    void tearDown() {
        logger.detachAppender(appender);
        appender.stop();
    }

    @Test
    void logsResumeRoutingFieldsWithoutSensitivePayloads() {
        AssistantChatDto request = new AssistantChatDto();
        request.setActionType(ActionType.RESUME);
        request.setTraceId("trace-1");
        request.setSessionId(100L);
        request.setClientRequestId("client-1");
        request.setSourceAgentType("BY_SUPER");
        request.setMetadata("{\"parent_run_id\":\"run-1\",\"interaction_id\":\"interaction-1\","
            + "\"delegation_id\":\"delegation-1\",\"Beyond-Token\":\"secret-token\"}");

        RunningChatInfo runningInfo = new RunningChatInfo();
        runningInfo.setRunning(true);
        runningInfo.setTraceId("trace-1");

        Map<String, Object> payload = new HashMap<>();
        payload.put("status", "COMPLETED");
        payload.put("reply_data", "private reply");
        Map<String, Object> metadata = new HashMap<>();
        metadata.put("parent_run_id", "run-1");
        metadata.put("interaction_id", "interaction-1");
        metadata.put("delegation_id", "delegation-1");
        metadata.put("Beyond-Token", "secret-token");
        metadata.put("request_headers", Map.of("Beyond-Token", "secret-token"));

        ResumeRoutingTraceLogger.logWebSocketIngress(request);
        ResumeRoutingTraceLogger.logRunningState(request, runningInfo);
        ResumeRoutingTraceLogger.logGatewayEgress(request, "100", "trace-1", "BY_SUPER", "answer-1", "-1",
            "private answer", payload, metadata, 1);

        String messages = appender.list.stream()
            .map(ILoggingEvent::getFormattedMessage)
            .reduce("", (left, right) -> left + "\n" + right);
        assertThat(messages)
            .contains("stage=WS_INGRESS", "stage=RUNNING_STATE", "stage=GATEWAY_EGRESS")
            .contains("traceId=trace-1", "parentRunId=run-1", "interactionId=interaction-1")
            .contains("decision=REUSE_RUNNING_TRACE", "status=COMPLETED", "replyDataType=string")
            .doesNotContain("secret-token", "private reply", "private answer");
    }
}
