package com.iwhalecloud.byai.state.domain.groupchat;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.lenient;
import static org.mockito.Mockito.mock;

import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;

/** 旧写入用例也运行真实归属服务，避免新依赖被空实现绕过。 */
final class GroupChatTopicTestSupport {
    private GroupChatTopicTestSupport() {}

    static void install(Object writer, ByaiMessageMapper messages, Long groupId, Long rootId) {
        GroupChatTopicService topics = new GroupChatTopicService(messages, mock(ByaiGroupChatTopicMapper.class),
            mock(SessionService.class));
        ReflectionTestUtils.setField(writer, "topicService", topics);
        lenient().when(messages.insert(any(ByaiMessage.class))).thenReturn(1);
        if (rootId != null) {
            ByaiMessage root = new ByaiMessage();
            root.setMessageId(rootId);
            root.setSessionId(groupId);
            root.setTopicId(rootId);
            root.setUsage(1);
            root.setMessageContent("Original request");
            lenient().when(messages.selectByMessageId(rootId)).thenReturn(root);
        }
    }
}
