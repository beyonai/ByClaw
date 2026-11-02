package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.listener;

import com.aliyun.dingtalkcard_1_0.Client;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.DingtalkChannelService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.*;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards.*;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.support.DingtalkCallbackMessageParser;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.MockedStatic;
import org.slf4j.MDC;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.OutputStream;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.ThreadPoolExecutor;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicInteger;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class DingtalkBotDispatchTest extends I18nTestSupport {
    private final DingtalkUserService users = mock(DingtalkUserService.class);
    private final DingtalkFileDownloadService files = mock(DingtalkFileDownloadService.class);
    private final DingtalkReplyDispatcher replies = mock(DingtalkReplyDispatcher.class);
    private final DingtalkCardService cards = mock(DingtalkCardService.class);
    private final DingtalkCallbackMessageParser parser = mock(DingtalkCallbackMessageParser.class);
    private final DingtalkSessionService sessions = mock(DingtalkSessionService.class);
    private final DingtalkChannelService channel = mock(DingtalkChannelService.class);
    private final IndexService index = mock(IndexService.class);
    private final CountDownLatch release = new CountDownLatch(1);
    private final AtomicInteger tracks = new AtomicInteger();
    private DingtalkBotListener listener;
    private LoginInfo login;
    private MockedStatic<RedisUtil> redis;

    @BeforeEach
    void configure() throws Exception {
        DingtalkStreamProperties properties = new DingtalkStreamProperties();
        properties.getDispatch().setPreparationWorkers(1);
        properties.getDispatch().setPreparationQueueCapacity(1);
        properties.getDispatch().setChatWorkers(1);
        properties.getDispatch().setChatQueueCapacity(1);
        listener = new DingtalkBotListener(new ObjectMapper(), users, files, replies, cards, parser,
            sessions, properties, channel);
        ReflectionTestUtils.setField(listener, "indexService", index);
        redis = mockStatic(RedisUtil.class);
        redis.when(() -> RedisUtil.setIfAbsent(anyString(), eq("1"), anyLong())).thenReturn(true);
        login = new LoginInfo();
        login.setUserId(1001L);
        login.setUserCode("alice");
        when(users.resolveLoginInfo(any())).thenAnswer(invocation -> {
            CurrentUserHolder.setLoginInfo(login);
            return login;
        });
        AuthDigitEmployVo employee = new AuthDigitEmployVo();
        employee.setId(2001L);
        employee.setName("测试员工");
        when(index.selectAuthDigitEmploy(any())).thenReturn(List.of(employee));
        when(sessions.resolveSessionId(any(), any(), any())).thenReturn(3001L);
        when(channel.validateRequest(any())).thenReturn(true);
        when(cards.createAssistantReplyCardSession(any(), any(), any(), any(), any())).thenAnswer(invocation ->
            new DingtalkCardStreamSession(mock(Client.class), "token", "track-" + tracks.incrementAndGet()));
        when(files.downloadMessageFiles(any(), any())).thenReturn(List.of());
        doAnswer(invocation -> {
            OutputStream output = invocation.getArgument(1);
            output.write("{\"event\":\"appStreamResponse\"}".getBytes(StandardCharsets.UTF_8));
            return null;
        }).when(channel).chat(any(), any());
        when(parser.parse(anyMap())).thenAnswer(invocation -> {
            Map<String, Object> payload = invocation.getArgument(0);
            DingtalkCallbackMessage message = new DingtalkCallbackMessage();
            message.setMsgId((String) payload.get("msgId"));
            message.setMsgtype("text");
            message.setTextContent("你好");
            message.setRobotCode("robot");
            message.setSenderStaffId("sender");
            message.setConversationId("conversation");
            message.setConversationType("1");
            message.setSessionWebhook("https://example.test/webhook");
            return message;
        });
    }

    @AfterEach
    void cleanup() {
        release.countDown();
        listener.shutdown();
        redis.close();
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void sendsCardBeforeAttachmentsAndPropagatesThenClearsThreadContext() throws Exception {
        CountDownLatch attachmentEntered = new CountDownLatch(1);
        when(files.downloadMessageFiles(any(), any())).thenAnswer(invocation -> {
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("alice");
            AssistantChatDto dto = invocation.getArgument(1);
            assertThat(MDC.get("dingtalkRequestId")).isEqualTo(dto.getClientRequestId());
            attachmentEntered.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            return List.of();
        });

        listener.execute(Map.of("msgId", "first"));

        assertThat(attachmentEntered.await(5, TimeUnit.SECONDS)).isTrue();
        verify(cards).createAssistantReplyCardSession(any(), any(), any(), any(), any());
        verify(channel, never()).chat(any(), any());
        release.countDown();
        verify(channel, timeout(5000)).chat(any(), any());
        for (String pool : List.of("preparationExecutor", "chatExecutor")) {
            ThreadPoolExecutor executor = (ThreadPoolExecutor) ReflectionTestUtils.getField(listener, pool);
            assertThat(executor.submit(() -> CurrentUserHolder.getLoginInfo() == null
                && MDC.get("dingtalkRequestId") == null
                && LocaleContextHolder.getLocaleContext() == null).get(5, TimeUnit.SECONDS)).isTrue();
        }
    }

    @Test
    void longRunningChatDoesNotBlockTheNextInitialCard() throws Exception {
        CountDownLatch chatEntered = new CountDownLatch(1);
        doAnswer(invocation -> {
            chatEntered.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            invocation.<OutputStream>getArgument(1).write("{\"event\":\"appStreamResponse\"}".getBytes(StandardCharsets.UTF_8));
            return null;
        }).when(channel).chat(any(), any());
        listener.execute(Map.of("msgId", "first"));
        assertThat(chatEntered.await(5, TimeUnit.SECONDS)).isTrue();

        listener.execute(Map.of("msgId", "second"));

        verify(cards, timeout(5000).times(2)).createAssistantReplyCardSession(any(), any(), any(), any(), any());
        verify(channel, times(1)).chat(any(), any());
    }

    @Test
    void fullChatQueueFinalizesCardWithBusyNotice() throws Exception {
        CountDownLatch downloadEntered = new CountDownLatch(1);
        when(files.downloadMessageFiles(any(), any())).thenAnswer(invocation -> {
            downloadEntered.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            return List.of();
        });
        listener.execute(Map.of("msgId", "first"));
        assertThat(downloadEntered.await(5, TimeUnit.SECONDS)).isTrue();
        listener.execute(Map.of("msgId", "second"));
        verify(cards, timeout(5000).times(2)).createAssistantReplyCardSession(any(), any(), any(), any(), any());
        // Wait for the second preparation task to finish enqueueing before submitting the third.
        ThreadPoolExecutor executor = (ThreadPoolExecutor) ReflectionTestUtils.getField(listener, "preparationExecutor");
        executor.submit(() -> { }).get(5, TimeUnit.SECONDS);

        listener.execute(Map.of("msgId", "third"));

        verify(cards, timeout(5000)).streamingUpdateAssistantReply(any(), eq("当前咨询人数较多，请稍后再试。"), eq(true));
        verify(channel, never()).chat(any(), any());
    }

    @Test
    void fullPreparationQueueRepliesBusyWithoutRunningChatOnCallbackThread() throws Exception {
        CountDownLatch lookupEntered = new CountDownLatch(1);
        when(users.resolveLoginInfo(any())).thenAnswer(invocation -> {
            lookupEntered.countDown();
            assertThat(release.await(5, TimeUnit.SECONDS)).isTrue();
            return login;
        });
        listener.execute(Map.of("msgId", "first"));
        assertThat(lookupEntered.await(5, TimeUnit.SECONDS)).isTrue();
        listener.execute(Map.of("msgId", "second"));

        listener.execute(Map.of("msgId", "third"));

        verify(replies).sendTextMessage(anyString(), eq("当前咨询人数较多，请稍后再试。"));
        verify(users, times(1)).resolveLoginInfo(any());
        verify(channel, never()).chat(any(), any());
    }

    @Test
    void cardCreationFailureActuallySendsTextAndSkipsDownloadAndChat() throws Exception {
        when(cards.createAssistantReplyCardSession(any(), any(), any(), any(), any()))
            .thenThrow(new IllegalStateException("card unavailable"));

        listener.execute(Map.of("msgId", "failed"));

        verify(replies, timeout(5000)).sendTextMessage(anyString(), eq("抱歉，遇到了点问题，请稍后再试"));
        verify(files, never()).downloadMessageFiles(any(), any());
        verify(channel, never()).chat(any(), any());
    }

    @Test
    void unauthorizedUserNeverGetsCardOrTriggersChat() throws Exception {
        when(index.selectAuthDigitEmploy(any())).thenReturn(List.of());

        listener.execute(Map.of("msgId", "unauthorized"));

        verify(replies, timeout(5000)).sendTextMessage(anyString(), contains("权限"));
        verify(cards, never()).createAssistantReplyCardSession(any(), any(), any(), any(), any());
        verify(files, never()).downloadMessageFiles(any(), any());
    }

    @Test
    void attachmentFailureEndsTheWaitingCard() throws Exception {
        when(files.downloadMessageFiles(any(), any())).thenThrow(new IllegalStateException("download failed"));

        listener.execute(Map.of("msgId", "bad-file"));

        verify(cards, timeout(5000)).streamingUpdateAssistantReply(any(), eq("抱歉，遇到了点问题，请稍后再试"), eq(true));
        verify(channel, never()).chat(any(), any());
    }

    @Test
    void failedErrorCardFallsBackToText() throws Exception {
        when(files.downloadMessageFiles(any(), any())).thenThrow(new IllegalStateException("download failed"));
        doThrow(new IllegalStateException("card unavailable")).when(cards).streamingUpdateAssistantReply(any(), any(), anyBoolean());

        listener.execute(Map.of("msgId", "bad-file"));

        verify(replies, timeout(5000)).sendTextMessage(anyString(), eq("抱歉，遇到了点问题，请稍后再试"));
    }

    @Test
    void duplicateCallbackDoesNotSendAnotherCard() throws Exception {
        redis.when(() -> RedisUtil.setIfAbsent(anyString(), eq("1"), anyLong())).thenReturn(false);

        listener.execute(Map.of("msgId", "duplicate"));

        verifyNoInteractions(users, cards, files, channel);
    }

    @ParameterizedTest
    @ValueSource(strings = {"1", "2"})
    void imageAttachmentsAndStreamingRepliesPreserveSingleAndGroupChatContext(String conversationType) throws Exception {
        DingtalkCallbackMessage message = parser.parse(Map.of("msgId", "image"));
        message.setConversationType(conversationType);
        message.setMsgtype("picture");
        message.setTextContent("");
        when(parser.parse(anyMap())).thenReturn(message);
        login.setSessionDatasetId(4001L);
        var file = new com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto();
        file.setFileId("5001");
        file.setFileName("chart.png");
        file.setFilePath("/session/chart.png");
        file.setFileType("image");
        when(files.downloadMessageFiles(any(), any())).thenReturn(List.of(file));
        doAnswer(invocation -> {
            AssistantChatDto dto = invocation.getArgument(0);
            assertThat(dto.getFiles()).containsExactly(file);
            assertThat(dto.getChatContent()).isEqualTo(" ");
            assertThat(dto.getAgentId()).isEqualTo(2001L);
            assertThat(dto.getSessionId()).isEqualTo(3001L);
            assertThat(dto.getClientRequestId()).isEqualTo(MDC.get("dingtalkRequestId"));
            assertThat(dto.getExtParams().get("files").toString()).contains("4001", "5001", "chart.png");
            assertThat(CurrentUserHolder.getCurrentUserCode()).isEqualTo("alice");
            invocation.<OutputStream>getArgument(1).write(("{\"event\":\"answerDelta\",\"contentType\":\"1002\","
                + "\"choices\":[{\"delta\":{\"content\":\"已读取图片\"}}]}{\"event\":\"appStreamResponse\"}")
                .getBytes(StandardCharsets.UTF_8));
            return null;
        }).when(channel).chat(any(), any());

        listener.execute(Map.of("msgId", "image"));

        verify(cards, timeout(5000)).streamingUpdateAssistantReply(any(), eq("已读取图片"), eq(true));
        verify(sessions).resolveSessionId(eq(""), eq("2".equals(conversationType) ? "senderconversation" : "conversation"), eq(2001L));
        verifyNoInteractions(replies);
    }

    @Test
    void modelFailureFinalizesCardAndSendsRetryText() throws Exception {
        doThrow(new IllegalStateException("model unavailable")).when(channel).chat(any(), any());
        doAnswer(invocation -> {
            if (invocation.<Boolean>getArgument(2)) {
                invocation.<DingtalkCardStreamSession>getArgument(0).setFinalized(true);
            }
            return null;
        }).when(cards).streamingUpdateAssistantReply(any(), any(), anyBoolean());

        listener.execute(Map.of("msgId", "model-failure"));

        verify(replies, timeout(5000)).sendTextMessage(anyString(), eq("抱歉，遇到了点问题，请稍后再试"));
        verify(cards).streamingUpdateAssistantReply(any(), anyString(), eq(true));
    }
}
