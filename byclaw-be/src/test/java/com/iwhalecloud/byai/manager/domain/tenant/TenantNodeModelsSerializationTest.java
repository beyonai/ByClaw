package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageView;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MessageOutline;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.Page;
import java.util.List;
import org.junit.jupiter.api.Test;

class TenantNodeModelsSerializationTest {

    @Test
    void historicalMessagesCanBeWrittenByThePublicApiJsonConverter() {
        MessageView message = new MessageView("123", "456", "789", null, null, null,
            "assistant", "1", "Assistant", "2026-09-29T10:00:00Z", "hello",
            null, null, null, null, null, null, true, true, false, null, null);

        String json = JSON.toJSONString(new Page<>(List.of(message), 1, 1, 20, 1));

        assertThat(json).contains("\"messageId\":\"123\"");
        assertThat(json).contains("\"isComplete\":true");
    }

    @Test
    void messageOutlineCanBeWrittenByThePublicApiJsonConverter() {
        String json = JSON.toJSONString(List.of(new MessageOutline("123", "assistant", 2,
            "hello", "hello", "Assistant", "2026-09-29T10:00:00Z", 1, 1, false)));

        assertThat(json).contains("\"messageId\":\"123\"");
    }
}
