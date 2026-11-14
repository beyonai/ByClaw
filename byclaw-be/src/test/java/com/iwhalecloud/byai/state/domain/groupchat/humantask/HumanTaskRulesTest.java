package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import org.junit.jupiter.api.Test;
import static org.junit.jupiter.api.Assertions.*;

class HumanTaskRulesTest {
    @Test void directSubmissionRequiresTextOrAttachments() {
        assertThrows(RuntimeException.class, () -> HumanTaskRules.content(JSON.parseObject("{\"text\":\"   \"}")));
        HumanTaskRules.content(JSON.parseObject("{\"files\":[{\"filePath\":\"/a\",\"fileName\":\"a\"}]}"));
    }
    @Test void reviewCannotApproveAnOutdatedVersion() {
        JSONObject task = JSON.parseObject("{\"status\":\"PENDING_REVIEW\",\"revision\":4,\"latestSubmissionId\":\"22\"}");
        assertThrows(RuntimeException.class, () -> HumanTaskRules.review(task, JSON.parseObject("{\"decision\":\"ACCEPT\",\"expectedRevision\":3,\"submissionId\":\"21\"}")));
        HumanTaskRules.review(task, JSON.parseObject("{\"decision\":\"ACCEPT\",\"expectedRevision\":4,\"submissionId\":\"22\"}"));
    }
    @Test void returnRequiresOpinionAndAcceptedTasksCannotBeSubmitted() {
        JSONObject task = JSON.parseObject("{\"status\":\"PENDING_REVIEW\",\"revision\":4,\"latestSubmissionId\":\"22\"}");
        assertThrows(RuntimeException.class, () -> HumanTaskRules.review(task, JSON.parseObject("{\"decision\":\"RETURN\",\"expectedRevision\":4,\"submissionId\":\"22\"}")));
        assertThrows(RuntimeException.class, () -> HumanTaskRules.writable(JSON.parseObject("{\"status\":\"ACCEPTED\"}")));
    }
    @Test void hashIsIndependentOfJsonObjectKeyOrder() {
        assertEquals(HumanTaskRules.hash(JSON.parseObject("{\"a\":1,\"b\":2}")), HumanTaskRules.hash(JSON.parseObject("{\"b\":2,\"a\":1}")));
    }
}
