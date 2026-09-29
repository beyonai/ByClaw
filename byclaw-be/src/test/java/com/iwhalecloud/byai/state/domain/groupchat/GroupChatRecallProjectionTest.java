package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.*;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.AfterEach;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import com.iwhalecloud.byai.common.util.RedisUtil;
import org.springframework.test.util.ReflectionTestUtils;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextRequest;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.message.qo.MessageHotQo;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatRecallProjection;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

class GroupChatRecallProjectionTest {
    private Object previousRedis;
    private ValueOperations<String, String> values;

    @BeforeEach
    @SuppressWarnings("unchecked")
    void setUpRedis() {
        previousRedis = ReflectionTestUtils.getField(RedisUtil.class, "instance");
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        values = mock(ValueOperations.class);
        when(redis.opsForValue()).thenReturn(values);
        RedisUtil utility = new RedisUtil();
        ReflectionTestUtils.setField(utility, "stringRedisTemplate", redis);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", utility);
    }

    @AfterEach
    void restoreRedis() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", previousRedis);
    }
    @Test
    void redisNameIsDeduplicatedAndEveryContentCarrierIsRemovedFromCopy() {
        {
            when(values.get("SHARE_BFM_USER_8")).thenReturn("{\"userName\":\"张三\"}");
            ByaiMessage original = recalled();
            original.setFinalContent("SECRET");
            original.setMessageStruct("SECRET");
            original.setFinalMessageStruct("SECRET");
            original.setInferLog("SECRET");
            original.setDocMessageContent("SECRET");
            original.setRelatedResources("SECRET");
            original.setMetadata("{\"resourceList\":[\"SECRET\"],\"clientRequestId\":\"request\"}");
            GroupChatRecallProjection projection = new GroupChatRecallProjection();
            ByaiMessage safe = projection.display(original);
            projection.display(original);
            assertThat(JSON.toJSONString(safe)).doesNotContain("SECRET");
            assertThat(safe.getMessageContent()).isEqualTo("张三 撤回了一条消息");
            assertThat(original.getMessageContent()).isEqualTo("SECRET");
            assertThat(safe.getMessageId()).isEqualTo(original.getMessageId());
            verify(values, times(1)).get("SHARE_BFM_USER_8");
            when(values.get("SHARE_BFM_USER_8")).thenReturn("{\"userName\":\"新名字\"}");
            assertThat(new GroupChatRecallProjection().display(original).getMessageContent()).startsWith("新名字");
        }
    }

    @Test
    void cacheMissingOrUnavailableStillMasksContent() {
        {
            when(values.get("SHARE_BFM_USER_8")).thenReturn(null);
            assertThat(new GroupChatRecallProjection().display(recalled()).getMessageContent()).isEqualTo("用户（8） 撤回了一条消息");
            when(values.get("SHARE_BFM_USER_8")).thenThrow(new IllegalStateException());
            assertThat(new GroupChatRecallProjection().display(recalled()).getMessageContent()).doesNotContain("SECRET");
        }
    }

    @Test
    void historyAndNestedReferencesHaveDifferentSafeTextAndKeepIdentity() {
        ByaiMessage parent = recalled();
        ByaiMessage reply = new ByaiMessage();
        reply.setMessageId(2L);
        reply.setSessionId(10L);
        reply.setUsage(1);
        reply.setMessageContent("reply");
        reply.setMessageRef(1L);
        GroupChatContextService context = new GroupChatContextService(mock(ByaiMessageMapper.class),
            mock(SessionService.class), mock(SsResourceService.class));
        ReflectionTestUtils.setField(context, "taskMapper", mock(ByaiGroupChatTaskMapper.class));
        var output = context.toMessages(List.of(parent, reply), Map.of(1L, parent));
        assertThat(output.get(0).isRecalled()).isTrue();
        assertThat(output.get(0).getAttachments()).isEmpty();
        assertThat(output.get(0).getContent()).endsWith(" 撤回了一条消息");
        assertThat(output.get(1).getReplyTo().isRecalled()).isTrue();
        assertThat(output.get(1).getReplyTo().getContent()).isEqualTo("消息已撤回");
        assertThat(output.get(1).getReplyTo().getMessageId()).isEqualTo("1");
        assertThat(JSON.toJSONString(output)).doesNotContain("SECRET");
    }

    @Test
    void retainedLongBodyDoesNotEvictOtherMessagesFromTimelineOrFreshAgentContext() {
        ByaiMessage parent = recalled();
        parent.setMessageContent("SECRET".repeat(10000));
        ByaiMessage reply = new ByaiMessage();
        reply.setMessageId(2L);
        reply.setSessionId(10L);
        reply.setUsage(1);
        reply.setMessageContent("reply");
        ByaiMessageMapper mapper = mock(ByaiMessageMapper.class);
        SessionService sessions = mock(SessionService.class);
        when(sessions.findById(10L)).thenReturn(new ByaiSession());
        when(mapper.selectTimelineBeforeMessageId(10L, 3L, 60)).thenReturn(List.of(reply, parent));
        when(mapper.selectVisibleBeforeMessageId(10L, 3L, 60)).thenReturn(List.of(reply, parent));
        GroupChatContextService context = new GroupChatContextService(mapper, sessions, mock(SsResourceService.class));
        ReflectionTestUtils.setField(context, "taskMapper", mock(ByaiGroupChatTaskMapper.class));
        GroupChatContextRequest request = new GroupChatContextRequest();
        request.setConversationKey("10");
        request.setBeforeMessageId("3");
        request.setMaxCharacters(100);
        assertThat(context.loadTimeline(request).getMessages()).hasSize(2);
        var agent = context.load(request);
        assertThat(agent.getMessages()).hasSize(2);
        assertThat(JSON.toJSONString(agent)).doesNotContain("SECRET");
        assertThat(parent.getMessageContent()).hasSize(60000);
    }

    @Test
    void genericDetailsAndShareQueriesUseSafeCopies() {
        ByaiMessageMapper mapper = mock(ByaiMessageMapper.class);
        ByaiMessage source = recalled();
        source.setMessageStruct("SECRET");
        source.setRelatedResources("SECRET");
        when(mapper.selectByMessageId(1L)).thenReturn(source);
        when(mapper.selectByQo(any())).thenReturn(List.of(source));
        ByaiMessageHotService service = new ByaiMessageHotService();
        ReflectionTestUtils.setField(service, "byaiMessageMapper", mapper);
        assertThat(JSON.toJSONString(service.findById(1L))).doesNotContain("SECRET");
        assertThat(service.findById(1L).isRecalled()).isTrue();
        assertThat(JSON.toJSONString(service.findByQo(new MessageHotQo()))).doesNotContain("SECRET");
        assertThat(source.getMessageStruct()).isEqualTo("SECRET");
    }

    private ByaiMessage recalled() {
        ByaiMessage message = new ByaiMessage();
        message.setMessageId(1L);
        message.setSessionId(10L);
        message.setUsage(1);
        message.setMessageContent("SECRET");
        message.setRecalledAt(new Date(100));
        message.setRecalledBy(8L);
        return message;
    }
}
