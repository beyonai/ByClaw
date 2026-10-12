package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.Page;
import java.util.List;
import org.junit.jupiter.api.Test;

class TenantChatHistoryProjectionTest {

    @Test
    void archivedWorkerReplyKeepsThinkingAndAnswerVisibleToTheExistingFrontend() {
        MessageView answer = new MessageView();
        answer.setMessageId("2");
        answer.setSessionId("1");
        answer.setRole("assistant");
        answer.setUsage(2);
        answer.setMessageContent("<think>分析请求</think>\n\n你好，陈舵主！");

        TenantChatHistoryProjection.project(answer);

        assertThat(answer.getInferLog()).contains("\"contentType\":1001", "分析请求");
        assertThat(answer.getMessageStruct()).contains("\"contentType\":1002", "你好，陈舵主！");
        assertThat(JSON.toJSONString(new Page<>(List.of(answer), 1, 1, 20, 1)))
            .contains("messageStruct", "你好，陈舵主！");
    }

    @Test
    void existingStructuredHistoryIsPreserved() {
        MessageView answer = new MessageView();
        answer.setRole("assistant");
        answer.setMessageContent("plain answer");
        answer.setMessageStruct("original");

        TenantChatHistoryProjection.project(answer);

        assertThat(answer.getMessageStruct()).isEqualTo("original");
    }
    @Test
    void legacyTenantOrderedHistoryRestoresNumericSequencesWithoutRoundingIds() {
        MessageView answer = new MessageView();
        answer.setRole("assistant");
        answer.setMessageStruct("[{\"seq\":\"2\",\"contentType\":\"2008\",\"messageId\":\"8011237409000004498\"}]");
        answer.setInferLog("[{\"seq\":\"1\",\"contentType\":\"1001\"}]");
        TenantChatHistoryProjection.project(answer);
        assertThat(JSON.parseArray(answer.getMessageStruct()).getJSONObject(0).get("seq")).isInstanceOf(Integer.class);
        assertThat(JSON.parseArray(answer.getInferLog()).getJSONObject(0).get("seq")).isInstanceOf(Integer.class);
        assertThat(JSON.parseArray(answer.getMessageStruct()).getJSONObject(0).get("messageId"))
            .isEqualTo("8011237409000004498");
    }

}
