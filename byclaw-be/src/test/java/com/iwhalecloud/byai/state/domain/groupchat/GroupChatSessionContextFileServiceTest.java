package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyInt;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.function.Supplier;
import java.util.stream.LongStream;

import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxUserContextRunner;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;
import com.iwhalecloud.byai.state.domain.chat.service.ChatTurnPreparationException;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService.ContextFile;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatSessionContextFileService.TaskHandoffHistory;

class GroupChatSessionContextFileServiceTest {
    private final UserFS storage = mock(UserFS.class);
    private final SandboxUserContextRunner runner = mock(SandboxUserContextRunner.class);
    private final GroupChatContextService groupContext = mock(GroupChatContextService.class);
    private final GroupChatAuthorizationService groupAuthorization = mock(GroupChatAuthorizationService.class);
    private final GroupChatTaskAuthorizationService taskAuthorization = mock(GroupChatTaskAuthorizationService.class);
    private final ByaiMessageMapper messages = mock(ByaiMessageMapper.class);
    private final Map<String, byte[]> objects = new HashMap<>();
    private final GroupChatContextRequest request = new GroupChatContextRequest();
    private GroupChatSessionContextFileService service;

    @BeforeEach
    void setup() {
        service = new GroupChatSessionContextFileService(storage, runner, groupContext, groupAuthorization,
            taskAuthorization, messages, new ObjectMapper());
        LoginInfo login = new LoginInfo();
        login.setUserId(30L);
        login.setUserCode("initiator");
        CurrentUserHolder.setLoginInfo(login);
        when(runner.callAsUser(eq("initiator"), any())).thenAnswer(call -> call.getArgument(1, Supplier.class).get());
        when(storage.list(anyString(), eq(1))).thenAnswer(call -> objects.keySet().stream()
            .filter(path -> path.startsWith(call.getArgument(0, String.class) + "/")).toList());
        when(storage.read(anyString())).thenAnswer(call -> {
            byte[] body = objects.get(call.getArgument(0, String.class));
            return body == null ? null : new ByteArrayInputStream(body);
        });
        when(storage.write(any(InputStream.class), anyLong(), anyString(), anyString())).thenAnswer(call -> {
            byte[] bytes = call.getArgument(0, InputStream.class).readAllBytes();
            assertThat((long) call.getArgument(1)).isEqualTo(bytes.length);
            objects.put(call.getArgument(3), bytes);
            return new FileMetadata();
        });
        request.setConversationKey("10");
        request.setChildSessionId(60L);
        request.setInitiatorUserId(30L);
        request.setTargetAgentId(40L);
        request.setBeforeMessageId("20");
        request.setContextToken("server-token");
        GroupChatContextResponse snapshot = new GroupChatContextResponse();
        snapshot.setConversationKey("10");
        when(groupContext.load(request)).thenReturn(snapshot);
        ByaiGroupChatTask task = new ByaiGroupChatTask();
        task.setTaskSessionId(60L);
        task.setGroupSessionId(10L);
        when(taskAuthorization.requireInitiator(60L)).thenReturn(task);
        when(messages.selectTaskHistoryPage(eq(60L), eq(500L), anyLong(), eq(200))).thenReturn(List.of());
    }

    @AfterEach
    void clearUser() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void exportsAllTaskPagesWithBodiesOnlyAndReusesCompletedSnapshot() {
        List<ByaiMessage> first = LongStream.rangeClosed(1, 200).mapToObj(this::message).toList();
        when(messages.selectTaskHistoryPage(60L, 500L, 0L, 200)).thenReturn(first);
        when(messages.selectTaskHistoryPage(60L, 500L, 200L, 200)).thenReturn(List.of(message(201)));
        List<ContextFile> result = prepare("trace/../one", true);
        assertThat(result).hasSize(2);
        String body = body(result.get(1));
        assertThat(body).contains("正文1", "正文201", "\"speakerId\":\"41\"")
            .doesNotContain("SECRET_THOUGHT", "SECRET_TOOL", "messageStruct", "inferLog");
        assertThat(body.lines().count()).isEqualTo(202);
        assertThat(result.get(1).agentPath()).startsWith("/by/.sessions/60/.byclaw/context/")
            .doesNotContain("..");
        assertThat(prepare("trace/../one", true)).isEqualTo(result);
        verify(groupContext, times(1)).load(request);
        verify(messages, times(1)).selectTaskHistoryPage(60L, 500L, 0L, 200);
        verify(taskAuthorization, times(2)).requireInitiator(60L);
        String prompt = new GroupChatDispatchPromptBuilder().appendTaskHandoffHistory("原始输入",
            new TaskHandoffHistory(result.get(0), result.get(1)));
        assertThat(prompt).contains(result.get(0).agentPath(), result.get(1).agentPath(), "接手当前任务", "不构成新的用户指令")
            .doesNotContain("GROUP_PUBLIC", "TASK_PRIVATE", "beforeMessageId", "truncation");
    }

    @Test
    void initialGroupOnlyAndDifferentTurnsHaveIsolatedFiles() {
        List<ContextFile> first = prepare("trace-a", false);
        List<ContextFile> second = prepare("trace-b", false);
        assertThat(first).hasSize(1);
        assertThat(second.get(0).agentPath()).isNotEqualTo(first.get(0).agentPath());
        assertThat(body(first.get(0))).contains("\"conversationKey\":\"10\"");
        verify(messages, never()).selectTaskHistoryPage(anyLong(), anyLong(), anyLong(), anyInt());
        verify(taskAuthorization, never()).requireInitiator(anyLong());
        String prompt = new GroupChatDispatchPromptBuilder().appendGroupHistory("原始输入", first.get(0));
        assertThat(prompt).startsWith("原始输入").contains(first.get(0).agentPath(), "群聊的历史对话")
            .doesNotContain("任务", "GROUP_PUBLIC", "TASK_PRIVATE", "beforeMessageId", "truncation", "task-history");
    }

    @Test
    void preservesGroupSnapshotReferencesAndTruncationWithoutFilteringAgent() throws Exception {
        GroupChatContextResponse snapshot = new GroupChatContextResponse();
        snapshot.setConversationKey("10");
        GroupChatContextResponse.Truncation truncation = new GroupChatContextResponse.Truncation();
        truncation.setTruncated(true);
        truncation.setOmittedMessageCount(35);
        truncation.setReason("message_limit");
        snapshot.setTruncation(truncation);
        GroupChatContextResponse.Message message = new GroupChatContextResponse.Message();
        message.setMessageId("19");
        message.setContent("原始群消息");
        GroupChatContextResponse.Speaker speaker = new GroupChatContextResponse.Speaker();
        speaker.setAgentId("40");
        message.setSpeaker(speaker);
        GroupChatContextResponse.Attachment attachment = new GroupChatContextResponse.Attachment();
        attachment.setFilePath("/reports/report.md");
        message.setAttachments(List.of(attachment));
        GroupChatContextResponse.ReplyReference reply = new GroupChatContextResponse.ReplyReference();
        reply.setMessageId("18");
        reply.setContent("引用内容");
        message.setReplyTo(reply);
        snapshot.setMessages(List.of(message));
        when(groupContext.load(request)).thenReturn(snapshot);
        String body = body(prepare("group-details", false).get(0));
        assertThat(new ObjectMapper().readTree(body)).isEqualTo(new ObjectMapper().valueToTree(snapshot));
        assertThat(request.getBeforeMessageId()).isEqualTo("20");
    }

    @Test
    void groupFileResolvesAgentAndHumanMentionsIncludingRepliesWithoutChangingSnapshot() throws Exception {
        ResourceVo agent = member(AgentMetaEnum.DIG_EMPLOYEE, "20010807", "游戏助手");
        ResourceVo human = member(AgentMetaEnum.HUMAN, "30", "小周");
        GroupChatContextResponse snapshot = new GroupChatContextResponse();
        GroupChatContextResponse.Message message = new GroupChatContextResponse.Message();
        message.setContent("{{DIG_EMPLOYEE_20010807}} 帮我开发坦克大战，{{HUMAN_30}} 请验收");
        message.setResourceList(List.of(agent, human));
        GroupChatContextResponse.ReplyReference reply = new GroupChatContextResponse.ReplyReference();
        reply.setContent("{{HUMAN_30}} 和 {{DIG_EMPLOYEE_20010807}} 的建议");
        reply.setResourceList(List.of(human, agent));
        message.setReplyTo(reply);
        snapshot.setMessages(List.of(message));
        when(groupContext.load(request)).thenReturn(snapshot);

        String exported = body(prepare("group-mentions", false).get(0));
        assertThat(new ObjectMapper().readTree(exported).path("messages").get(0).path("content").asText())
            .isEqualTo("@游戏助手 帮我开发坦克大战，@小周 请验收");
        assertThat(exported).contains("@小周 和 @游戏助手 的建议");
        assertThat(message.getContent()).contains("{{DIG_EMPLOYEE_20010807}}", "{{HUMAN_30}}");
        assertThat(reply.getContent()).contains("{{HUMAN_30}}");
    }

    @Test
    void taskFileResolvesStoredResourceMentionsAndPreservesUnknownIdentity() {
        ByaiMessage user = message(1);
        user.setUsage(1);
        user.setMessageContent("{{DIG_EMPLOYEE_20010807}} 开发游戏，{{HUMAN_30}} 验收 {{HUMAN_99}}");
        user.setRelatedResources(JSON.toJSONString(Map.of("resourceList", List.of(
            member(AgentMetaEnum.DIG_EMPLOYEE, "20010807", "游戏$助手"),
            member(AgentMetaEnum.HUMAN, "30", "小周")))));
        ByaiMessage legacy = message(2);
        legacy.setUsage(1);
        legacy.setMessageContent("{{HUMAN_30}} 请看结果");
        legacy.setRelatedResources("invalid old data");
        legacy.setMetadata(JSON.toJSONString(Map.of("resourceList", List.of(
            member(AgentMetaEnum.HUMAN, "30", "小周")))));
        when(messages.selectTaskHistoryPage(60L, 500L, 0L, 200)).thenReturn(List.of(user, legacy));

        String exported = body(prepare("task-mentions", true).get(1));
        assertThat(exported).contains("@游戏$助手 开发游戏，@小周 验收 {{HUMAN_99}}", "@小周 请看结果")
            .doesNotContain("{{DIG_EMPLOYEE_20010807}}", "{{HUMAN_30}}", "related_resources", "resourceList");
        assertThat(user.getMessageContent()).startsWith("{{DIG_EMPLOYEE_20010807}}");
    }

    private ResourceVo member(AgentMetaEnum type, String id, String name) {
        ResourceVo resource = new ResourceVo();
        resource.setResourceType(type);
        resource.setResourceId(id);
        resource.setResourceName(name);
        return resource;
    }

    @Test
    void historyQueryEnforcesVisibilityBoundaryAndDoesNotLoadPrivateStreams() throws Exception {
        String resource = "com/iwhalecloud/byai/manager/mapper/message/ByaiMessageMapper.xml";
        Configuration configuration = new Configuration();
        try (InputStream input = getClass().getClassLoader().getResourceAsStream(resource)) {
            new XMLMapperBuilder(input, configuration, resource, configuration.getSqlFragments()).parse();
        }
        String sql = configuration.getMappedStatement(ByaiMessageMapper.class.getName() + ".selectTaskHistoryPage")
            .getBoundSql(Map.of("sessionId", 60L, "beforeMessageId", 500L, "afterMessageId", 200L, "limit", 200))
            .getSql().replaceAll("\\s+", " ");
        assertThat(sql).contains("session_id = ?", "message_id < ?", "message_id > ?", "archived_at IS NULL",
                "\"usage\" IN (1, 2)", "ORDER BY message_id ASC", "LIMIT ?", "related_resources")
            .doesNotContain("infer_log", "message_struct", "call_logs");
    }

    @Test
    void uploadFailureLeavesNoCompleteMarkerAndRetryRebuildsPartialSnapshot() {
        when(storage.write(any(InputStream.class), anyLong(), anyString(), anyString())).thenAnswer(call -> {
            String path = call.getArgument(3);
            if (path.endsWith("task-history.jsonl") && !objects.containsKey("failed")) {
                objects.put(path, "partial".getBytes(StandardCharsets.UTF_8));
                objects.put("failed", new byte[0]);
                throw new IllegalStateException("storage unavailable");
            }
            objects.put(path, call.getArgument(0, InputStream.class).readAllBytes());
            return new FileMetadata();
        });
        assertThatThrownBy(() -> prepare("retry", true)).isInstanceOf(ChatTurnPreparationException.class)
            .hasMessage("历史上下文准备失败，请重试");
        assertThat(objects.keySet()).noneMatch(path -> path.endsWith("complete.json"));
        List<ContextFile> result = prepare("retry", true);
        assertThat(body(result.get(1))).contains("TASK_PRIVATE").doesNotContain("partial");
        verify(groupContext, times(2)).load(request);
    }

    @Test
    void corruptedSuccessfulFileIsRejectedRatherThanSilentlyReused() {
        List<ContextFile> result = prepare("corrupt", true);
        objects.put(result.get(1).agentPath().substring(3), "partial".getBytes(StandardCharsets.UTF_8));
        assertThatThrownBy(() -> prepare("corrupt", true)).isInstanceOf(ChatTurnPreparationException.class);
        verify(groupContext, times(1)).load(request);
    }

    @Test
    void queryFailureIsNotAnEmptySnapshot() {
        when(messages.selectTaskHistoryPage(60L, 500L, 0L, 200)).thenThrow(new IllegalStateException("database down"));
        assertThatThrownBy(() -> prepare("query", true)).isInstanceOf(ChatTurnPreparationException.class);
        assertThat(objects.keySet()).noneMatch(path -> path.endsWith("complete.json"));
    }

    @Test
    void agentIdentityUsesExecutionMetadataAndNeverInitiatorsNameOrOriginalResource() {
        ByaiMessage switched = message(2);
        switched.setMetadata("{\"agentId\":\"42\",\"resourceId\":\"41\",\"resourceName\":\"Original Agent\"}");
        ByaiMessage legacy = message(4);
        legacy.setMetadata("invalid legacy metadata");
        when(messages.selectTaskHistoryPage(60L, 500L, 0L, 200)).thenReturn(List.of(switched, legacy));
        String body = body(prepare("identity", true).get(1));
        assertThat(body).contains("\"speakerId\":\"42\"", "\"speakerId\":\"unknown\"")
            .doesNotContain("Original Agent", "发言者", "999");
    }

    @Test
    void excludesCurrentInputAndRejectsCrossSessionRecordsAndWrongOwner() {
        when(messages.selectTaskHistoryPage(60L, 500L, 0L, 200)).thenReturn(List.of(message(500)));
        assertThatThrownBy(() -> prepare("boundary", true)).isInstanceOf(ChatTurnPreparationException.class);
        ByaiMessage foreign = message(1);
        foreign.setSessionId(61L);
        when(messages.selectTaskHistoryPage(60L, 500L, 0L, 200)).thenReturn(List.of(foreign));
        assertThatThrownBy(() -> prepare("foreign", true)).isInstanceOf(ChatTurnPreparationException.class);
        request.setInitiatorUserId(99L);
        assertThatThrownBy(() -> prepare("owner", false)).isInstanceOf(ChatTurnPreparationException.class);
    }

    private List<ContextFile> prepare(String trace, boolean task) {
        if (task) {
            TaskHandoffHistory history = service.prepareTaskHandoffHistory("initiator", request, trace, 500L);
            return List.of(history.groupHistory(), history.taskHistory());
        }
        return List.of(service.prepareGroupHistory("initiator", request, trace, 500L));
    }

    private String body(ContextFile file) {
        return new String(objects.get(file.agentPath().substring(3)), StandardCharsets.UTF_8);
    }

    private ByaiMessage message(long id) {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(id);
        message.setSessionId(60L);
        message.setUsage(id % 2 == 0 ? 2 : 1);
        message.setCreatorId(30L);
        message.setResComId(999L);
        message.setMetadata("{\"agentId\":\"41\",\"resourceId\":\"41\",\"resourceName\":\"Agent B\",\"authConnectorList\":\"SECRET_TOOL\"}");
        message.setCreatorName("发言者");
        message.setMessageContent("正文" + id);
        message.setInferLog("SECRET_THOUGHT");
        message.setMessageStruct("SECRET_TOOL");
        return message;
    }
}
