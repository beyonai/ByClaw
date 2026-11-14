package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSONObject;
import java.util.List;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNull;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

/**
 * Verifies optional list view binding at the HTTP boundary.
 *
 * @author Codex
 * @since 2026-11-14
 */
class HumanTaskListControllerTest {
    private HumanTaskService service;

    private MockMvc mvc;

    /** Uses the production controller with a captured application call. */
    @BeforeEach
    void setup() {
        service = mock(HumanTaskService.class);
        when(service.call(eq("list"), any())).thenReturn(new JSONObject());
        mvc = MockMvcBuilders.standaloneSetup(new HumanTaskController(service)).build();
    }

    /** A supplied view reaches the service alongside pagination and legacy filters. */
    @Test
    void forwardsViewToService() throws Exception {
        mvc.perform(get("/group-human-tasks").param("view", "PENDING_MODIFICATION")
            .param("relation", "INITIATED").param("status", "ACCEPTED")
            .param("pageNum", "2").param("pageSize", "5")).andExpect(status().isOk());
        JSONObject body = capturedBody();
        assertEquals("PENDING_MODIFICATION", body.getString("view"));
        assertEquals("INITIATED", body.getString("relation"));
        assertEquals("ACCEPTED", body.getString("status"));
        assertEquals(2, body.getIntValue("pageNum"));
        assertEquals(5, body.getIntValue("pageSize"));
    }

    /** Omitting view preserves the established endpoint defaults. */
    @Test
    void omittedViewRetainsLegacyDefaults() throws Exception {
        mvc.perform(get("/group-human-tasks")).andExpect(status().isOk());
        JSONObject body = capturedBody();
        assertNull(body.getString("view"));
        assertEquals("ALL", body.getString("relation"));
        assertNull(body.getString("status"));
        assertEquals(1, body.getIntValue("pageNum"));
        assertEquals(20, body.getIntValue("pageSize"));
    }

    /** Explicit empty values must survive binding so domain validation can reject them. */
    @Test
    void emptyViewIsNotTreatedAsOmitted() throws Exception {
        mvc.perform(get("/group-human-tasks").param("view", "")).andExpect(status().isOk());
        assertEquals("", capturedBody().getString("view"));
    }

    /** The static counts route takes precedence over the numeric task-detail route. */
    @Test
    void countsEndpointReturnsAllBadgesWithoutForwardingListFilters() throws Exception {
        when(service.call(eq("counts"), any())).thenReturn(JSONObject.parseObject(
            "{\"pendingReview\":2,\"pendingCompletion\":3,\"pendingModification\":1,\"total\":5}"));
        mvc.perform(get("/group-human-tasks/counts").param("view", "PENDING_REVIEW"))
            .andExpect(status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.pendingReview").value(2))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.pendingCompletion").value(3))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.pendingModification").value(1))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.total").value(5));
        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(service).call(eq("counts"), body.capture());
        assertEquals(0, body.getValue().size());
    }

    /** Both query endpoints forward the optional group filter without widening identity scope. */
    @Test
    void forwardsGroupFilterForListAndCounts() throws Exception {
        mvc.perform(get("/group-human-tasks").param("groupSessionId", "11298374"))
            .andExpect(status().isOk());
        assertEquals("11298374", capturedBody().getString("groupSessionId"));
        when(service.call(eq("counts"), any())).thenReturn(new JSONObject());
        mvc.perform(get("/group-human-tasks/counts").param("groupSessionId", "11298374"))
            .andExpect(status().isOk());
        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(service).call(eq("counts"), body.capture());
        assertEquals("11298374", body.getValue().getString("groupSessionId"));
    }

    /** Comma-separated selections are bound as individual string IDs. */
    @Test
    void groupListForwardsCommaSeparatedPeopleAndPagination() throws Exception {
        when(service.call(eq("groupList"), any())).thenReturn(new JSONObject());
        mvc.perform(get("/group-chats/30/human-tasks")
            .param("initiatorUserIds", "21,22").param("assigneeUserIds", "23,24")
            .param("status", "ACCEPTED").param("pageNum", "2").param("pageSize", "5"))
            .andExpect(status().isOk());
        JSONObject body = capturedGroupBody();
        assertEquals("30", body.getString("groupSessionId"));
        assertEquals(List.of("21", "22"), body.get("initiatorUserIds"));
        assertEquals(List.of("23", "24"), body.get("assigneeUserIds"));
        assertEquals("ACCEPTED", body.getString("status"));
        assertEquals(2, body.getIntValue("pageNum"));
        assertEquals(5, body.getIntValue("pageSize"));
    }

    /** Repeated parameters retain their values and use the normal pagination defaults. */
    @Test
    void groupListForwardsRepeatedPeople() throws Exception {
        when(service.call(eq("groupList"), any())).thenReturn(new JSONObject());
        mvc.perform(get("/group-chats/30/human-tasks")
            .param("initiatorUserIds", "21", "22").param("assigneeUserIds", "23", "24"))
            .andExpect(status().isOk());
        JSONObject body = capturedGroupBody();
        assertEquals(List.of("21", "22"), body.get("initiatorUserIds"));
        assertEquals(List.of("23", "24"), body.get("assigneeUserIds"));
        assertEquals(1, body.getIntValue("pageNum"));
        assertEquals(20, body.getIntValue("pageSize"));
    }

    /** Omitted filters remain absent while explicit blank elements survive for domain rejection. */
    @Test
    void groupListDoesNotDropBlankSelectionElements() throws Exception {
        when(service.call(eq("groupList"), any())).thenReturn(new JSONObject());
        mvc.perform(get("/group-chats/30/human-tasks")
            .param("initiatorUserIds", "21", "").param("status", ""))
            .andExpect(status().isOk());
        JSONObject body = capturedGroupBody();
        assertEquals(List.of("21", ""), body.get("initiatorUserIds"));
        assertNull(body.get("assigneeUserIds"));
        assertEquals("", body.getString("status"));
    }

    /** Captures the independent group-list action rather than the personal-list action. */
    private JSONObject capturedGroupBody() {
        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(service).call(eq("groupList"), body.capture());
        return body.getValue();
    }

    /** Returns the request passed through the controller. */
    private JSONObject capturedBody() {
        ArgumentCaptor<JSONObject> body = ArgumentCaptor.forClass(JSONObject.class);
        verify(service).call(eq("list"), body.capture());
        return body.getValue();
    }
}
