package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.cards;

import com.aliyun.dingtalkcard_1_0.models.CreateAndDeliverRequest;
import com.aliyun.dingtalkcard_1_0.models.PrivateDataValue;
import com.aliyun.dingtalkcard_1_0.models.StreamingUpdateRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotConfigService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkTokenService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkRobotChannelConfig;
import org.junit.jupiter.api.Test;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.concurrent.atomic.AtomicBoolean;
import java.util.concurrent.atomic.AtomicInteger;
import java.util.concurrent.atomic.AtomicReference;

import static org.assertj.core.api.Assertions.assertThat;

class DingtalkCardServiceTest {

    private final ObjectMapper objectMapper = new ObjectMapper();
    private final DingtalkRobotConfigService robotConfigService = new DingtalkRobotConfigService(objectMapper);
    private final DingtalkTokenService tokenService = new DingtalkTokenService(robotConfigService);
    private final DingtalkCardService service = new DingtalkCardService(objectMapper, tokenService, robotConfigService);

    @Test
    void shouldConvertCardDataToStringValues() {
        Map<String, Object> rawCardData = new LinkedHashMap<>();
        rawCardData.put("title", "智能体回复");
        rawCardData.put("count", 2);
        rawCardData.put("tags", List.of("A", "B"));
        rawCardData.put("meta", Map.of("score", 99));
        rawCardData.put("nullable", null);

        Map<String, String> result = service.convertCardData(rawCardData);

        assertThat(result)
                .containsEntry("title", "智能体回复")
                .containsEntry("count", "2")
                .containsEntry("tags", "[\"A\",\"B\"]")
                .containsEntry("meta", "{\"score\":99}")
                .containsEntry("nullable", "");
    }

    @Test
    void shouldBuildAssistantReplyCardParamMap() {
        assertThat(service.buildAssistantReplyCardParamMap("测试智能体"))
                .containsEntry("lastMessage", "来自 测试智能体 的回复")
                .containsEntry("content", "来自 测试智能体 的回复")
                .containsEntry("copyContent", "")
                .containsEntry("resources", "[]")
                .containsEntry("users", "[]")
                .containsEntry("progress", "100")
                .containsEntry("commandList", "[]");
    }

    @Test
    void shouldBuildSingleChatRequest() {
        CreateAndDeliverRequest request = service.buildAssistantReplyRequest(
                "user-001",
                "robot-001",
                DingtalkCardService.SINGLE_CHAT_TYPE,
                "cid-001",
                "track-001",
                "card-template-001.schema",
                Map.of("content", "hello")
        );

        assertThat(request.getCardTemplateId()).isEqualTo("card-template-001.schema");
        assertThat(request.getOpenSpaceId()).isEqualTo("dtv1.card//im_robot.user-001");
        assertThat(request.getImRobotOpenDeliverModel()).isNotNull();
        assertThat(request.getImRobotOpenDeliverModel().getRobotCode()).isEqualTo("robot-001");
        assertThat(request.getImRobotOpenDeliverModel().getSpaceType()).isEqualTo("IM_ROBOT");
        assertThat(request.getImGroupOpenDeliverModel()).isNull();
    }

    @Test
    void shouldBuildGroupChatRequest() {
        CreateAndDeliverRequest request = service.buildAssistantReplyRequest(
                "user-001",
                "robot-001",
                DingtalkCardService.GROUP_CHAT_TYPE,
                "open-conversation-001",
                "track-002",
                "card-template-002.schema",
                Map.of("content", "hello")
        );

        assertThat(request.getCardTemplateId()).isEqualTo("card-template-002.schema");
        assertThat(request.getOpenSpaceId()).isEqualTo("dtv1.card//im_group.open-conversation-001");
        assertThat(request.getImGroupOpenDeliverModel()).isNotNull();
        assertThat(request.getImGroupOpenDeliverModel().getRobotCode()).isEqualTo("robot-001");
        assertThat(request.getImRobotOpenDeliverModel()).isNull();
    }

    @Test
    void shouldResolveRobotSpecificCardTemplateIdFirst() {
        DingtalkRobotConfigService localRobotConfigService = new DingtalkRobotConfigService(objectMapper);
        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setResourceId(1L);
        config.setRobotCode("robot-001");
        config.setClientId("client-001");
        config.setClientSecret("secret-001");
        config.setCardTemplateId("robot-card-template.schema");
        localRobotConfigService.replaceRobotConfigsForResource(1L, List.of(config));

        DingtalkCardService cardService = new DingtalkCardService(objectMapper, new DingtalkTokenService(localRobotConfigService), localRobotConfigService);

        assertThat(cardService.resolveCardTemplateId("robot-001")).isEqualTo("robot-card-template.schema");
    }

    @Test
    void shouldFallbackToDefaultCardTemplateIdWhenRobotSpecificValueMissing() {
        DingtalkRobotConfigService localRobotConfigService = new DingtalkRobotConfigService(objectMapper);
        DingtalkRobotChannelConfig config = new DingtalkRobotChannelConfig();
        config.setResourceId(1L);
        config.setRobotCode("robot-001");
        config.setClientId("client-001");
        config.setClientSecret("secret-001");
        localRobotConfigService.replaceRobotConfigsForResource(1L, List.of(config));

        DingtalkCardService cardService = new DingtalkCardService(objectMapper, new DingtalkTokenService(localRobotConfigService), localRobotConfigService);

        assertThat(cardService.resolveCardTemplateId("robot-001")).isEqualTo("9b643b4e-9602-4dab-811a-290d13299e14.schema");
        assertThat(cardService.resolveCardTemplateId("unknown-robot")).isEqualTo("9b643b4e-9602-4dab-811a-290d13299e14.schema");
    }

    @Test
    void shouldBuildStreamingUpdateRequest() {
        assertThat(service.buildStreamingUpdateRequest("track-003", "guid-003", "content", "hello", true))
                .extracting(
                        StreamingUpdateRequest::getOutTrackId,
                        StreamingUpdateRequest::getGuid,
                        StreamingUpdateRequest::getKey,
                        StreamingUpdateRequest::getContent,
                        StreamingUpdateRequest::getIsFull,
                        StreamingUpdateRequest::getIsFinalize
                )
                .containsExactly("track-003", "guid-003", "content", "hello", true, true);
    }

    @Test
    void shouldBuildCopyContentUpdateRequestWithoutFinalize() {
        assertThat(service.buildStreamingUpdateRequest("track-004", "guid-004", "copyContent", "copy", false))
                .extracting(
                        StreamingUpdateRequest::getOutTrackId,
                        StreamingUpdateRequest::getGuid,
                        StreamingUpdateRequest::getKey,
                        StreamingUpdateRequest::getContent,
                        StreamingUpdateRequest::getIsFull,
                        StreamingUpdateRequest::getIsFinalize
                )
                .containsExactly("track-004", "guid-004", "copyContent", "copy", true, false);
    }

    @Test
    void shouldBuildDebugPrivateData() {
        Map<String, PrivateDataValue> privateData = service.buildDebugPrivateData("user-001");

        assertThat(privateData).containsKey("user-001");
        assertThat(privateData.get("user-001").getCardParamMap())
                .containsEntry("_CARD_DEBUG_TOOL_ENTRY", "show");
    }

    @Test
    void shouldStreamAnswerDeltaFromOutputStream() throws Exception {
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }
        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-001")
        );

        outputStream.write("""
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"你"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"好"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(latestContent.get()).isEqualTo("你好");
        assertThat(finalized.get()).isTrue();
    }

    @Test
    void shouldHandleAnswerStartDeltaAndEndEvents() throws Exception {
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }

        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-002")
        );

        outputStream.write("""
                {"event":"answerStart","messageId":"m-001","contentType":"1002"}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"你"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"好"}}]}
                {"event":"answerEnd","role":"assistant","contentType":"1002"}
                """.getBytes());

        assertThat(finalized.get()).isFalse();
        outputStream.finish();

        assertThat(latestContent.get()).isEqualTo("你好");
        assertThat(finalized.get()).isTrue();
    }

    @Test
    void shouldHandleReasonStartDeltaAndEndEvents() throws Exception {
        List<String> streamedContents = new ArrayList<>();
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                streamedContents.add(content);
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }

        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-003")
        );

        outputStream.write("""
                {"event":"reasoningLogStart","messageId":"m-003"}
                {"event":"reasoningLogDelta","contentType":"1002","choices":[{"delta":{"content":"用"}}]}
                {"event":"reasoningLogDelta","contentType":"1002","choices":[{"delta":{"content":"户"}}]}
                {"event":"reasoningLogEnd","role":"assistant"}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"答"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"案"}}]}
                """.getBytes());

        assertThat(finalized.get()).isFalse();
        outputStream.finish();

        assertThat(streamedContents).contains(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;用</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;用户</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;用户</em></span>\n\n---\n\n答",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;用户</em></span>\n\n---\n\n答案"
        );
        assertThat(latestContent.get()).isEqualTo(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;用户</em></span>\n\n---\n\n答案"
        );
        assertThat(finalized.get()).isTrue();
    }

    @Test
    void shouldInsertMarkdownLineBreakWhenReasonContentTypeChanges() throws Exception {
        List<String> streamedContents = new ArrayList<>();
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                streamedContents.add(content);
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }

        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-005")
        );

        outputStream.write("""
                {"event":"reasoningLogDelta","contentType":"1001","orderId":"r-001","choices":[{"delta":{"content":"第一段"}}]}
                {"event":"reasoningLogDelta","contentType":"1001","orderId":"r-001","choices":[{"delta":{"content":"继续"}}]}
                {"event":"reasoningLogDelta","contentType":"3003","orderId":"r-002","choices":[{"delta":{"content":"标题"}}]}
                {"event":"reasoningLogDelta","contentType":"3003","orderId":"r-002","parentOrderId":"1","choices":[{"delta":{"content":"补充"}}]}
                {"event":"reasoningLogDelta","contentType":"1002","orderId":"r-003","choices":[{"delta":{"content":"回正文"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"最终答案"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(streamedContents).contains(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段继续</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段继续</em></span>\n\n- **标题**",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段继续</em></span>\n\n- **标题****补充**",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段继续</em></span>\n\n- **标题****补充**\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;回正文</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段继续</em></span>\n\n- **标题****补充**\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;回正文</em></span>\n\n---\n\n最终答案"
        );
        assertThat(latestContent.get()).isEqualTo(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;第一段继续</em></span>\n\n- **标题****补充**\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;回正文</em></span>\n\n---\n\n最终答案"
        );
        assertThat(finalized.get()).isTrue();
    }

    @Test
    void shouldFlushReasoningTextBufferWhenCurrentRootParentOrderIsTrue() throws Exception {
        List<String> streamedContents = new ArrayList<>();
        AtomicReference<String> latestContent = new AtomicReference<>("");

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                streamedContents.add(content);
                latestContent.set(content);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }
        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-008")
        );

        outputStream.write("""
                {"event":"reasoningLogDelta","contentType":"1002","orderId":"r-010","choices":[{"delta":{"content":"上一段"}}]}
                {"event":"reasoningLogDelta","contentType":"1002","orderId":"r-011","parentOrderId":"-1","choices":[{"delta":{"content":"根级"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"答案"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(streamedContents).contains(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段</em></span>\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;根级</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段</em></span>\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;根级</em></span>\n\n---\n\n答案"
        );
        assertThat(latestContent.get()).isEqualTo(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段</em></span>\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;根级</em></span>\n\n---\n\n答案"
        );
    }

    @Test
    void shouldNotFlushReasoningTextBufferWhenOrderIdIsSame() throws Exception {
        List<String> streamedContents = new ArrayList<>();
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                streamedContents.add(content);
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }
        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-009")
        );

        outputStream.write("""
                {"event":"reasoningLogDelta","contentType":"1002","orderId":"r-020","choices":[{"delta":{"content":"上一段"}}]}
                {"event":"reasoningLogDelta","contentType":"1002","orderId":"r-020","parentOrderId":"-1","choices":[{"delta":{"content":"根级"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"答案"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(streamedContents).contains(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段根级</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段根级</em></span>\n\n---\n\n答案"
        );
        assertThat(streamedContents).doesNotContain(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段</em></span>\n\n<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;根级</em></span>"
        );
        assertThat(latestContent.get()).isEqualTo(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;上一段根级</em></span>\n\n---\n\n答案"
        );
        assertThat(finalized.get()).isTrue();
    }

    @Test
    void shouldIgnoreUnsupportedReasonContentTypes() throws Exception {
        List<String> streamedContents = new ArrayList<>();
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                streamedContents.add(content);
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }

        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-006")
        );

        outputStream.write("""
                {"event":"reasoningLogDelta","contentType":"3004","choices":[{"delta":{"content":"引用资源"}}]}
                {"event":"reasoningLogDelta","contentType":"1002","choices":[{"delta":{"content":"正文"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"最终答案"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(streamedContents).contains(
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;正文</em></span>",
                "<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;正文</em></span>\n\n---\n\n最终答案"
        );
        assertThat(streamedContents).doesNotContain("引用资源");
        assertThat(latestContent.get()).isEqualTo("<span style=\"color:#a4aab2;\"><em>&emsp;&emsp;正文</em></span>\n\n---\n\n最终答案");
        assertThat(finalized.get()).isTrue();
    }

    @Test
    void shouldUpdateCopyContentWithoutFinalizingCard() throws Exception {
        AtomicInteger copyContentUpdateCount = new AtomicInteger();
        AtomicBoolean copyContentFinalized = new AtomicBoolean(false);
        AtomicBoolean contentFinalized = new AtomicBoolean(false);
        AtomicReference<String> latestCopyContent = new AtomicReference<>("");
        AtomicReference<String> latestContent = new AtomicReference<>("");

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                latestContent.set(content);
                contentFinalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                copyContentUpdateCount.incrementAndGet();
                latestCopyContent.set(copyContent);
                copyContentFinalized.set(session.isFinalized());
            }
        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-007")
        );

        outputStream.write("""
                {"event":"reasoningLogDelta","contentType":"1002","choices":[{"delta":{"content":"思考"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"结"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"论"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(copyContentUpdateCount.get()).isEqualTo(1);
        assertThat(latestCopyContent.get()).isEqualTo("结论");
        assertThat(copyContentFinalized.get()).isFalse();
        assertThat(latestContent.get()).contains("结论");
        assertThat(contentFinalized.get()).isTrue();
    }

    @Test
    void shouldOnlyStreamSupportedAnswerContentTypes() throws Exception {
        List<String> streamedContents = new ArrayList<>();
        AtomicReference<String> latestContent = new AtomicReference<>("");
        AtomicBoolean finalized = new AtomicBoolean(false);

        DingtalkCardService recordingService = new DingtalkCardService(objectMapper, tokenService, robotConfigService) {
            @Override
            public void streamingUpdateAssistantReply(DingtalkCardStreamSession session, String content, boolean isFinalize) {
                streamedContents.add(content);
                latestContent.set(content);
                finalized.set(isFinalize);
                if (isFinalize) {
                    session.setFinalized(true);
                }
            }

            @Override
            public void updateCopyContent(DingtalkCardStreamSession session, String copyContent) {
                // no-op for this unit test
            }

        };

        DingtalkCardStreamingOutputStream outputStream = new DingtalkCardStreamingOutputStream(
                objectMapper,
                recordingService,
                new DingtalkCardStreamSession(null, "", "track-004")
        );

        outputStream.write("""
                {"event":"answerDelta","contentType":"2008","choices":[{"delta":{"content":"任务卡片"}}]}
                {"event":"answerDelta","contentType":"1001","choices":[{"delta":{"content":"markdown"}}]}
                {"event":"answerDelta","contentType":"1002","choices":[{"delta":{"content":"文本"}}]}
                """.getBytes());
        outputStream.finish();

        assertThat(streamedContents).contains("markdown", "markdown文本");
        assertThat(streamedContents).doesNotContain("任务卡片");
        assertThat(latestContent.get()).isEqualTo("markdown文本");
        assertThat(finalized.get()).isTrue();
    }
}
