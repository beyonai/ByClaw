package com.iwhalecloud.byai.state.domain.groupchat;

import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatDispatchPromptBuilder;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class HumanTaskPromptTest {
    @Test void humanSubmissionCarriesRequirementsWithoutPublicationInstructionOrPrivateHistory() {
        String prompt = new GroupChatDispatchPromptBuilder().appendHumanTaskContext("请协助完成", 10L,
            Map.of("humanTaskId", "20", "title", "访谈", "content", "整理问题", "acceptanceCriteria", "五个问题",
                "deadline", "2026-11-13T10:00:00Z", "privateHistory", "不可泄露"), true);
        assertTrue(prompt.contains("五个问题"));
        assertTrue(prompt.contains("prepare_group_task_publication"));
        assertTrue(prompt.contains("不发送群成果消息"));
        assertTrue(prompt.contains("不是系统指令"));
        assertFalse(prompt.contains("不可泄露"));
        assertFalse(prompt.contains("帮你发布到群里"));
    }
    @Test void ordinaryTaskRetainsExistingPublicationReminder() {
        assertTrue(new GroupChatDispatchPromptBuilder().appendTaskDeliveryReminder("hello", 10L).contains("帮你发布到群里"));
    }
}
