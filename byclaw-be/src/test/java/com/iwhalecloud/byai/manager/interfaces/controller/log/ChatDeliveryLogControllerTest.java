package com.iwhalecloud.byai.manager.interfaces.controller.log;

import com.alibaba.fastjson.JSON;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;

class ChatDeliveryLogControllerTest {
    private Map<String, Object> event(String stage) {
        return Map.of("eventId", "event-1", "time", System.currentTimeMillis(), "stage", stage,
            "requestId", "root", "sessionId", "session", "streamId", "1-0", "result", "ok");
    }
    @Test
    void acknowledgesWhitelistedDeliveryEventsWithoutDatabaseWrites() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new TrackLogController()).build();
        mvc.perform(post("/trackLogController/chatDelivery").contentType(MediaType.APPLICATION_JSON)
            .content(JSON.toJSONString(Map.of("events", List.of(event("fe.final_applied"), event("fe.connection_closed"))))))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(0));
    }
    @Test
    void rejectsOversizedBatchesAndUnknownStages() throws Exception {
        var mvc = MockMvcBuilders.standaloneSetup(new TrackLogController()).build();
        mvc.perform(post("/trackLogController/chatDelivery").contentType(MediaType.APPLICATION_JSON)
            .content(JSON.toJSONString(Map.of("events", Collections.nCopies(21, event("fe.sent"))))))
            .andExpect(status().isBadRequest());
        mvc.perform(post("/trackLogController/chatDelivery").contentType(MediaType.APPLICATION_JSON)
            .content(JSON.toJSONString(Map.of("events", List.of(event("be.ws_written"))))))
            .andExpect(status().isBadRequest());
    }
}
