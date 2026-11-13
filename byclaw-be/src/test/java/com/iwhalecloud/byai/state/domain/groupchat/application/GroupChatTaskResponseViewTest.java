package com.iwhalecloud.byai.state.domain.groupchat.application;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.Mockito.CALLS_REAL_METHODS;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;

import java.util.List;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import org.junit.jupiter.api.Test;

/** 任务视图的公开 ID 必须保留完整十进制精度；创建者 Codex，2026-11-13。 */
class GroupChatTaskResponseViewTest {
    @Test
    void retainsLongIdsAsStringsAfterAddingResponseIdentity() {
        var service = mock(GroupChatTaskService.class, CALLS_REAL_METHODS);
        var task = new ByaiGroupChatTask();
        task.setTaskSessionId(9007199254740993L);
        task.setDispatchId(9007199254740995L);
        task.setSourceMessageId(9007199254740997L);
        task.setStatus("ACTIVE");
        doReturn(List.of(task)).when(service).list(10L);
        var view = service.listResponseViews(10L).get(0);
        assertEquals("9007199254740993", view.get("taskSessionId"));
        assertEquals("9007199254740997", view.get("sourceMessageId"));
        assertEquals("execution:9007199254740995", view.getString("responseId"));
    }
}
