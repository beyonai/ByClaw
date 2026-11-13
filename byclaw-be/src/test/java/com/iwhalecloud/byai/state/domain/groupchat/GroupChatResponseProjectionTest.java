package com.iwhalecloud.byai.state.domain.groupchat;
import java.util.HashMap;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertFalse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatResponseProjection;
class GroupChatResponseProjectionTest {
    @Test void runningChatDoesNotExposePrivateBinding() {
        var row = new HashMap<String, Object>();
        row.put("responseId", "turn:1"); row.put("status", "RUNNING"); row.put("disposition", "CHAT");
        row.put("traceId", "private"); row.put("answerMessageId", "private-answer");
        var view = GroupChatResponseProjection.view(row);
        assertEquals("RUNNING", view.getString("phase"));
        assertFalse(view.toJSONString().contains("private"));
    }
    @Test void recalledSourceOverridesCompletedReply() {
        var row = new HashMap<String, Object>();
        row.put("sourceRecalledAt", "now"); row.put("status", "SUCCEEDED");
        row.put("resultMessageId", "10"); row.put("resultContent", "secret");
        var view = GroupChatResponseProjection.view(row);
        assertEquals("CANCELLED", view.getString("phase"));
        assertFalse(view.containsKey("resultMessage"));
    }
}
