package com.iwhalecloud.byai.state.domain.groupchat;

import static org.junit.jupiter.api.Assertions.assertTrue;
import static org.junit.jupiter.api.Assertions.assertFalse;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;

class GroupChatDispatchPromptBuilderTest {
    @Test
    void deliveryReminderRequiresActualTaskDeliveryAndPreservesPublicationConfirmation() {
        String content = new GroupChatDispatchPromptBuilder().appendTaskDeliveryReminder("完成报告", 31L);
        assertTrue(content.contains("/by/.sessions/31/.byclaw/task-delivery.json"));
        assertTrue(content.contains("\"taskSessionId\":\"31\",\"delivered\":true"));
        assertTrue(content.contains("不得删除、重置或改为 false"));
        assertTrue(content.startsWith("完成报告\n\n"));
        assertTrue(content.contains("当前会话已判定为 TASK"));
        assertTrue(content.contains("更新后的产物"));
        assertTrue(content.contains("在答复末尾自然地提醒一次"));
        assertTrue(content.contains("确认没问题后，可以让我帮你发布到群里"));
        assertTrue(content.contains("尚未完成交付、执行失败、等待用户补充信息"));
        assertTrue(content.contains("CHAT 回复不提醒"));
        assertTrue(content.contains("不要将提醒写入 taskName 或 ackText"));
        assertTrue(content.contains("正在确认发布时"));
        assertTrue(content.contains("这条提醒本身不是发布授权"));
    }

    @Test
    void appendsFrozenTurnContextWithInstructionsToKeepItOutOfUserFacingOutput() {
        String input = "{\"原始用户需求\":\"生成报告\",\"本次消息\":\"解释结论\"}";
        String content = new GroupChatDispatchPromptBuilder().appendTurnContext("解释结论", input);

        assertTrue(content.startsWith("解释结论\n\n[群聊消息上下文"));
        assertTrue(content.endsWith(input));
        assertTrue(content.contains("当前处理对象是本次消息"));
        assertTrue(content.contains("不要在面向用户的正文、过程说明或最终答复中复述"));
    }

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
    void terminalChatFollowupDoesNotReopenTaskOrRepeatDisposition() {
        String content = new GroupChatDispatchPromptBuilder().appendChatContinuation("解释一下结论", List.of());
        assertTrue(content.contains("不要重新执行原始任务"));
        assertTrue(content.contains("不重新发布旧任务"));
        assertTrue(content.contains("不生成新交付物"));
        assertTrue(content.contains("不要委派其他助理"));
        assertTrue(content.contains("请在群里直接 @我 发起新请求，不要使用引用回复"));
        assertTrue(content.contains("普通问答直接回答"));
        assertFalse(content.contains("group-chat-disposition.json"));
    }
}
