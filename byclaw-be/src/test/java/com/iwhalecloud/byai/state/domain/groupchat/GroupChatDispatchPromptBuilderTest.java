package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

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
        assertTrue(content.contains("[@成员名称](uid=目标成员uid)"));
        assertFalse(content.contains("uid?="));
    }
    @Test
    void requiresSilentClassificationAcrossUserVisibleOutputs() {
        String content = new GroupChatDispatchPromptBuilder().append("你是谁", 21L, 31L);

        assertTrue(content.startsWith("你是谁"));
        assertTrue(content.contains("必须静默判断"));
        assertTrue(content.contains("包括过程说明、正文、最终答复以及文件中的 taskName、ackText"));
        assertTrue(content.contains("不得披露本次 TASK/CHAT 分类、判定理由"));
        assertTrue(content.contains("控制文件名或路径"));
        assertTrue(content.contains("执行实际文件写入"));
        assertTrue(content.contains("身份询问直接自我介绍"));
    }
}
