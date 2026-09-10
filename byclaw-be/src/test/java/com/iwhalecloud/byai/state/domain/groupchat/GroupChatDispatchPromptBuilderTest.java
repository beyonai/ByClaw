package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertTrue;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;

class GroupChatDispatchPromptBuilderTest {
    @Test
    void appendsDispatchSpecificFileContractAfterOriginalContent() {
        String content = new GroupChatDispatchPromptBuilder().append("帮我生成报告", 21L, 31L);

        assertTrue(content.startsWith("帮我生成报告"));
        assertTrue(content.contains("/by/.sessions/31/.byclaw/group-chat-disposition.json"));
        assertTrue(content.contains("\"dispatchId\":\"21\""));
        assertTrue(content.contains("TASK|CHAT"));
    }
}
