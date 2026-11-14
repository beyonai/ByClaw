package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class HumanTaskLocalServiceTest {
    private GroupHumanTaskMapper db;
    private HumanTaskLocalService service;
    private SequenceService ids;
    @BeforeEach void setup() {
        db=mock(GroupHumanTaskMapper.class);ids=mock(SequenceService.class);
        service=new HumanTaskLocalService(db,ids,mock(GroupChatAuthorizationService.class),mock(SessionMemberService.class),
            mock(SessionService.class),mock(ByaiMessageMapper.class),mock(GroupChatTopicService.class),mock(SessionExtService.class),mock(ByaiGroupChatTaskMapper.class),mock(SsResourceService.class));
        when(ids.nextVal()).thenReturn(99L);
    }
    private JSONObject call(String action,String json){return service.call(10L,20L,action,JSON.parseObject(json));}
    private java.util.Map<String,Object> batch(String payload) {
        return java.util.Map.of("payload", payload, "senderType", "USER", "senderId", 20L);
    }
    @Test void nonInitiatorCannotConfirmEvenAConfirmedProposal() {
        when(db.batch(10L,1L)).thenReturn(batch("{\"batchId\":\"1\",\"initiatorUserId\":\"21\",\"status\":\"CONFIRMED\"}"));
        assertThrows(RuntimeException.class,()->call("confirm","{\"batchId\":\"1\",\"expectedRevision\":0}"));
        verify(db,never()).insertTask(any());
    }
    @Test void confirmedProposalRetryReturnsOriginalTasks() {
        when(db.batch(10L,1L)).thenReturn(batch("{\"batchId\":\"1\",\"initiatorUserId\":\"20\",\"status\":\"CONFIRMED\"}"));
        when(db.batchTasks(10L,1L)).thenReturn(java.util.List.of("{\"humanTaskId\":\"2\"}"));
        assertEquals("2",call("confirm","{\"batchId\":\"1\",\"expectedRevision\":0}").getJSONArray("items").getJSONObject(0).getString("humanTaskId"));
        verify(db,never()).insertTask(any());
    }
    @Test void staleProposalCannotBeEdited() {
        when(db.batch(10L,1L)).thenReturn(batch("{\"batchId\":\"1\",\"initiatorUserId\":\"20\",\"status\":\"DRAFT\",\"revision\":2}"));
        assertThrows(RuntimeException.class,()->call("updateProposal","{\"batchId\":\"1\",\"expectedRevision\":1,\"items\":[{}]}"));
        verify(db,never()).updateBatch(any());
    }
    @Test void successfulSubmissionRetryWinsOverLaterAcceptedStatus() {
        when(db.task(10L,2L)).thenReturn("{\"humanTaskId\":\"2\",\"status\":\"ACCEPTED\"}");
        when(db.request(2L,"r")).thenReturn("{\"status\":\"SUCCEEDED\",\"payloadHash\":\"abc\",\"result\":{\"submissionId\":\"9\",\"version\":1}}");
        assertEquals("9",call("submit","{\"humanTaskId\":\"2\",\"requestId\":\"r\",\"payloadHash\":\"abc\"}").getString("submissionId"));
        verify(db,never()).updateTask(any());
    }
    @Test void changedPayloadCannotReuseCommittedRequest() {
        when(db.task(10L,2L)).thenReturn("{\"humanTaskId\":\"2\",\"status\":\"ACCEPTED\"}");
        when(db.request(2L,"r")).thenReturn("{\"status\":\"SUCCEEDED\",\"payloadHash\":\"abc\"}");
        assertThrows(RuntimeException.class,()->call("submit","{\"humanTaskId\":\"2\",\"requestId\":\"r\",\"payloadHash\":\"def\"}"));
    }
    @Test void concurrentTaskChangeCannotCreateSubmission() {
        when(db.task(10L,2L)).thenReturn("{\"humanTaskId\":\"2\",\"status\":\"PENDING_REVIEW\",\"revision\":1,\"latestVersion\":1}");
        when(db.updateTask(any())).thenReturn(0);
        assertThrows(RuntimeException.class,()->call("submit","{\"humanTaskId\":\"2\",\"requestId\":\"r\",\"text\":\"new\",\"sourceType\":\"DIRECT\"}"));
        verify(db,never()).insertSubmission(any());
    }
    @Test void uploadCheckpointCannotEraseConcurrentlyCommittedSubmission() {
        String hash="a".repeat(64);
        when(db.task(10L,2L)).thenReturn("{\"humanTaskId\":\"2\"}");
        when(db.requestState(2L,"r")).thenReturn(java.util.Map.of("payload","{\"status\":\"UPLOADING\",\"payloadHash\":\""+hash+"\"}","revision",1L));
        when(db.checkpointRequest(any())).thenReturn(0);
        when(db.request(2L,"r")).thenReturn("{\"status\":\"SUCCEEDED\",\"payloadHash\":\""+hash+"\",\"result\":{\"submissionId\":\"9\"}}");
        JSONObject result=call("checkpoint","{\"humanTaskId\":\"2\",\"requestId\":\"r\",\"payloadHash\":\""+hash+"\",\"payload\":{}}");
        assertEquals("SUCCEEDED",result.getString("status"));
        verify(db,never()).updateRequest(any());
    }
    @Test void supersededVersionStillRetainsItsReview() {
        when(db.task(10L,2L)).thenReturn("{\"humanTaskId\":\"2\",\"latestSubmissionId\":\"12\"}");
        when(db.submissions(10L,2L)).thenReturn(java.util.List.of("{\"submissionId\":\"12\"}","{\"submissionId\":\"11\"}"));
        when(db.reviews(10L,2L)).thenReturn(java.util.List.of("{\"submissionId\":\"11\",\"decision\":\"RETURN\",\"opinion\":\"fix\"}"));
        var items=call("history","{\"humanTaskId\":\"2\"}").getJSONArray("items");
        assertFalse(items.getJSONObject(0).getBooleanValue("superseded"));
        assertTrue(items.getJSONObject(1).getBooleanValue("superseded"));
        assertEquals("fix",items.getJSONObject(1).getJSONArray("reviews").getJSONObject(0).getString("opinion"));
    }
}
