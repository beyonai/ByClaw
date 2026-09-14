package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;

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
    @Test
    void terminalTaskAssessmentDoesNotAuthorizeBusinessExecutionOrAnnounceClassification() {
        String content = new GroupChatDispatchPromptBuilder().appendRoutingAssessment("补充新版报告", 21L, 31L);
        assertTrue(content.startsWith("补充新版报告"));
        assertTrue(content.contains("/by/.sessions/31/.byclaw/group-chat-disposition.json"));
        assertTrue(content.contains("仅分类，禁止执行业务"));
        assertTrue(content.contains("不得采集资料、修改业务文件、生成报告、调用其他助理"));
        assertTrue(content.contains("不输出正文、不发送回执"));
        assertFalse(content.contains("写入后直接处理原始请求"));
    }

    @Test
    void terminalChatFollowupDoesNotReopenTaskOrRepeatDisposition() {
        String content = new GroupChatDispatchPromptBuilder().appendChatContinuation("解释一下结论", List.of());
        assertTrue(content.contains("不要重新执行原始任务"));
        assertTrue(content.contains("不重新发布旧任务"));
        assertFalse(content.contains("group-chat-disposition.json"));
    }
}
