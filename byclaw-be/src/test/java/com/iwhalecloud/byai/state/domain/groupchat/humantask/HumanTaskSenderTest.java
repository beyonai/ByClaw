package com.iwhalecloud.byai.state.domain.groupchat.humantask;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.domain.tenant.TenantModeService;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeClient;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.GroupHumanTaskMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import java.util.UUID;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.Configuration;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.web.server.ResponseStatusException;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real mapper and transaction coverage for sender ownership and all-or-nothing batch creation. */
class HumanTaskSenderTest extends I18nTestSupport {
    private JdbcTemplate jdbc;
    private HumanTaskService service;
    private HumanTaskLocalService local;
    private SessionService sessions;
    private GroupHumanTaskMapper mapper;
    private SessionMemberService members;
    private SsResourceService resources;

    @BeforeEach void setup() {
        var dataSource = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";MODE=PostgreSQL;DB_CLOSE_DELAY=-1");
        jdbc = new JdbcTemplate(dataSource);
        jdbc.execute("""
            CREATE TABLE byai_group_human_task_batch (
                batch_id BIGINT PRIMARY KEY, enterprise_id BIGINT, group_session_id BIGINT, initiator_user_id BIGINT,
                sender_type VARCHAR(16) NOT NULL CHECK(sender_type IN ('USER','AGENT')), sender_id BIGINT NOT NULL,
                source_message_id BIGINT, card_message_id BIGINT,
                request_id VARCHAR(128), payload_hash VARCHAR(64), status VARCHAR(32), revision BIGINT, payload TEXT,
                create_time TIMESTAMP, update_time TIMESTAMP, UNIQUE(enterprise_id, initiator_user_id, request_id))
            """);
        jdbc.execute("""
            CREATE TABLE byai_group_human_task (
                human_task_id BIGINT PRIMARY KEY, enterprise_id BIGINT, group_session_id BIGINT, batch_id BIGINT,
                initiator_user_id BIGINT, assignee_user_id BIGINT, status VARCHAR(32), revision BIGINT,
                latest_version INT, latest_submission_id BIGINT, payload TEXT, create_time TIMESTAMP, update_time TIMESTAMP,
                CHECK(payload NOT LIKE '%"title":"Fail persist"%'))
            """);
        jdbc.execute("CREATE TABLE byai_group_chat_execution(candidate_session_id BIGINT, group_session_id BIGINT, source_message_id BIGINT, initiator_user_id BIGINT, target_agent_id BIGINT)");
        jdbc.execute("CREATE TABLE byai_group_chat_task(task_session_id BIGINT, group_session_id BIGINT, source_message_id BIGINT, initiator_user_id BIGINT, target_agent_id BIGINT)");
        jdbc.execute("CREATE TABLE timeline(message_id BIGINT PRIMARY KEY, payload TEXT)");
        var configuration = new Configuration(new Environment("human-task", new SpringManagedTransactionFactory(), dataSource));
        configuration.addMapper(GroupHumanTaskMapper.class);
        mapper = new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(configuration)).getMapper(GroupHumanTaskMapper.class);
        var sequence = mock(SequenceService.class);
        var ids = new AtomicLong(100L);
        when(sequence.nextVal()).thenAnswer(call -> ids.incrementAndGet());
        sessions = mock(SessionService.class);
        ByaiSession group = new ByaiSession();
        group.setSessionId(30L); group.setEnterpriseId(10L); group.setProjectId(11L);
        when(sessions.findById(30L)).thenReturn(group);
        ByaiSession execution = new ByaiSession();
        execution.setSessionId(60L); execution.setEnterpriseId(10L); execution.setParentSessionId(30L);
        when(sessions.findById(60L)).thenReturn(execution);
        members = mock(SessionMemberService.class);
        when(members.findSessionMember(eq(30L), anyString(), anyLong())).thenAnswer(call -> {
            Long id = call.getArgument(2);
            if (!List.of(20L, 21L, 70L).contains(id)) return null;
            ByaiSessionMember member = new ByaiSessionMember();
            member.setSessionId(30L); member.setMemObjId(id); member.setMemObjType(call.getArgument(1));
            member.setMemName(id == 70L ? "研究助理" : "小周");
            return member;
        });
        var messages = mock(ByaiMessageMapper.class);
        ByaiMessage source = new ByaiMessage();
        source.setMessageId(40L); source.setSessionId(30L); source.setCreatorId(20L); source.setUsage(1);
        when(messages.selectByMessageId(40L)).thenReturn(source);
        var topics = mock(GroupChatTopicService.class);
        doAnswer(call -> {
            ByaiMessage message = call.getArgument(0);
            jdbc.update("INSERT INTO timeline VALUES (?, ?)", message.getMessageId(), JSON.toJSONString(message));
            return null;
        }).when(topics).persistMessage(any());
        resources = mock(SsResourceService.class);
        var target = new HumanTaskLocalService(mapper, sequence, mock(GroupChatAuthorizationService.class), members,
            sessions, messages, topics, mock(SessionExtService.class), mock(ByaiGroupChatTaskMapper.class), resources);
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(new DataSourceTransactionManager(dataSource), new AnnotationTransactionAttributeSource()));
        local = (HumanTaskLocalService) proxy.getProxy();
        service = new HumanTaskService(local, mock(TenantModeService.class), mock(TenantNodeClient.class),
            mock(GroupChatEventPublisher.class), resources);
        login();
    }

    @AfterEach void cleanup() { CurrentUserHolder.clearLoginInfo(); }

    private void login() {
        LoginInfo login = new LoginInfo(); login.setUserId(20L); login.setEnterpriseId(10L);
        CurrentUserHolder.setLoginInfo(login);
    }

    private JSONObject input() {
        return JSON.parseObject("""
            {"groupSessionId":"30","requestId":"create","items":[
              {"title":"核对材料","content":"检查原始数据","assigneeUserId":"21","acceptanceCriteria":"可追溯"},
              {"title":"整理摘要","content":"汇总结果","assigneeUserId":"20"}]}
            """);
    }

    private int count(String table) { return jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class); }

    @Test void directCreationPersistsOneUserCardWithoutSourceOrProposal() {
        JSONObject batch = assertDoesNotThrow(() -> service.call("createDirect", input()));
        assertEquals("CONFIRMED", batch.getString("status"));
        assertEquals(1L, batch.getLongValue("revision"));
        assertEquals("USER", batch.getString("senderType"));
        assertEquals("20", batch.getString("senderId"));
        assertNull(batch.getString("sourceMessageId")); assertNull(batch.getString("proposalMessageId"));
        assertEquals(2, batch.getJSONArray("items").size());
        assertEquals(1, count("byai_group_human_task_batch")); assertEquals(2, count("byai_group_human_task")); assertEquals(1, count("timeline"));
        JSONObject message = JSON.parseObject(jdbc.queryForObject("SELECT payload FROM timeline", String.class));
        assertEquals("20", message.getString("creatorId")); assertEquals("小周", message.getString("creatorName"));
        assertEquals(1, message.getIntValue("usage")); assertNull(message.getLong("resComId"));
        assertEquals("user", message.getString("role"));
        assertEquals("HUMAN_TASK_BATCH", JSON.parseObject(message.getString("metadata")).getString("kind"));
        assertEquals("USER", jdbc.queryForObject("SELECT sender_type FROM byai_group_human_task_batch", String.class));
        assertEquals(20L, jdbc.queryForObject("SELECT sender_id FROM byai_group_human_task_batch", Long.class));
        var sender = members.findSessionMember(30L, "USER", 20L);
        when(members.findSessionMembers(30L, "USER", null)).thenReturn(List.of(sender));
        var context = new GroupChatContextService(mock(ByaiMessageMapper.class), sessions, mock(SsResourceService.class), members, null);
        var history = context.toMessages(List.of(message.toJavaObject(ByaiMessage.class))).get(0);
        assertEquals("user", history.getRole()); assertEquals("user", history.getSpeaker().getType());
        assertEquals(batch.getString("batchId"), history.getMetadata().get("batchId"));
        assertEquals(3, history.getMetadata().size());
        assertEquals("20", history.getSpeaker().getUserCode()); assertEquals("小周", history.getSpeaker().getDisplayName());
    }

    @Test void invalidItemPreventsAllBatchWrites() {
        JSONObject body = input(); body.getJSONArray("items").getJSONObject(1).remove("assigneeUserId");
        ResponseStatusException error = assertThrows(ResponseStatusException.class, () -> service.call("createDirect", body));
        assertEquals("HUMAN_TASK_ITEM_INCOMPLETE", error.getReason());
        assertEquals(0, count("byai_group_human_task_batch")); assertEquals(0, count("byai_group_human_task")); assertEquals(0, count("timeline"));
    }

    @Test void failureAfterFirstTaskInsertRollsBackTheEntireBatch() {
        JSONObject body = input(); body.getJSONArray("items").getJSONObject(1).put("title", "Fail persist");
        assertThrows(org.springframework.dao.DataIntegrityViolationException.class, () -> service.call("createDirect", body));
        assertEquals(0, count("byai_group_human_task_batch")); assertEquals(0, count("byai_group_human_task")); assertEquals(0, count("timeline"));
    }

    @Test void forgedSenderAndInitiatorDoNotChangeCanonicalIdentityOrResetSubmittedTask() {
        JSONObject first = assertDoesNotThrow(() -> service.call("createDirect", input()));
        Long taskId = first.getJSONArray("items").getJSONObject(0).getLong("humanTaskId");
        JSONObject task = JSON.parseObject(jdbc.queryForObject("SELECT payload FROM byai_group_human_task WHERE human_task_id=?", String.class, taskId));
        task.put("status", "PENDING_REVIEW"); task.put("latestVersion", 1); task.put("latestSubmissionId", "900");
        jdbc.update("UPDATE byai_group_human_task SET status='PENDING_REVIEW',latest_version=1,latest_submission_id=900,payload=? WHERE human_task_id=?", task.toJSONString(), taskId);
        JSONObject retry = input(); retry.put("senderType", "AGENT"); retry.put("senderId", "999"); retry.put("initiatorUserId", "999");
        retry.put("sourceTaskSessionId", "999"); retry.put("sourceMessageId", "999");
        JSONObject same = service.call("createDirect", retry);
        assertEquals(first.getString("batchId"), same.getString("batchId"));
        assertEquals("20", same.getString("senderId")); assertEquals("20", same.getString("initiatorUserId"));
        assertEquals("PENDING_REVIEW", same.getJSONArray("items").getJSONObject(0).getString("status"));
        assertEquals(1, same.getJSONArray("items").getJSONObject(0).getIntValue("latestVersion"));
        assertEquals(1, count("timeline")); assertEquals(2, count("byai_group_human_task"));
        retry.getJSONArray("items").getJSONObject(0).put("content", "changed");
        assertEquals("HUMAN_TASK_IDEMPOTENCY_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> service.call("createDirect", retry)).getReason());
    }

    @Test void concurrentIdenticalDirectRequestsReturnTheSameCommittedBatch() throws Exception {
        var ready = new CountDownLatch(2); var start = new CountDownLatch(1);
        var pool = Executors.newFixedThreadPool(2);
        try {
            java.util.concurrent.Callable<JSONObject> create = () -> {
                login(); ready.countDown(); assertTrue(start.await(10, TimeUnit.SECONDS));
                try { return service.call("createDirect", input()); } finally { CurrentUserHolder.clearLoginInfo(); }
            };
            var left = pool.submit(create); var right = pool.submit(create);
            assertTrue(ready.await(10, TimeUnit.SECONDS)); start.countDown();
            JSONObject a = assertDoesNotThrow(() -> left.get(15, TimeUnit.SECONDS));
            JSONObject b = assertDoesNotThrow(() -> right.get(15, TimeUnit.SECONDS));
            assertEquals(a.getString("batchId"), b.getString("batchId"));
            assertEquals(1, count("byai_group_human_task_batch")); assertEquals(2, count("byai_group_human_task")); assertEquals(1, count("timeline"));
        } finally { pool.shutdownNow(); }
    }

    @Test void ordinaryProposalMayOmitSourceButCannotReplayAsDirectCreation() {
        JSONObject body = input(); body.put("senderType", "AGENT"); body.put("senderId", "70");
        JSONObject batch = assertDoesNotThrow(() -> service.call("createProposal", body));
        assertEquals("DRAFT", batch.getString("status")); assertEquals("USER", batch.getString("senderType"));
        assertEquals("20", batch.getString("senderId")); assertEquals(0, count("byai_group_human_task"));
        assertEquals("HUMAN_TASK_IDEMPOTENCY_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> service.call("createDirect", input())).getReason());
    }

    @Test void executionSenderSurvivesConfirmationAndProjectsTheRealAgent() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70),(60,30,40,20,70)");
        jdbc.update("INSERT INTO byai_group_chat_task VALUES(60,30,40,20,70)");
        JSONObject body = input(); body.put("sourceTaskSessionId", "60"); body.put("senderId", "999");
        JSONObject proposal = assertDoesNotThrow(() -> local.call(10L, 20L, "createProposal", body));
        assertEquals("AGENT", proposal.getString("senderType")); assertEquals("70", proposal.getString("senderId"));
        assertEquals("20", proposal.getString("initiatorUserId")); assertEquals("60", proposal.getString("sourceTaskSessionId"));
        // Confirmation must use the batch identity even when the original execution is no longer available.
        jdbc.update("DELETE FROM byai_group_chat_execution"); jdbc.update("DELETE FROM byai_group_chat_task");
        when(members.findSessionMember(30L, "AGENT", 70L)).thenReturn(null);
        JSONObject confirm = JSON.parseObject("{\"expectedRevision\":0,\"senderType\":\"USER\",\"senderId\":\"999\"}");
        confirm.put("batchId", proposal.getString("batchId"));
        JSONObject batch = local.call(10L, 20L, "confirm", confirm);
        assertEquals("AGENT", batch.getString("senderType")); assertEquals("70", batch.getString("senderId"));
        for (String raw : jdbc.queryForList("SELECT payload FROM timeline", String.class)) {
            ByaiMessage message = JSON.parseObject(raw, ByaiMessage.class);
            assertEquals(70L, message.getCreatorId()); assertEquals("研究助理", message.getCreatorName());
            assertEquals(2, message.getUsage()); assertEquals(70L, message.getResComId());
            assertEquals("assistant", message.getRole());
            assertEquals("70", JSON.parseObject(message.getMetadata()).getString("targetAgentId"));
            var context = new GroupChatContextService(mock(ByaiMessageMapper.class), sessions, mock(SsResourceService.class));
            var history = context.toMessages(List.of(message)).get(0);
            assertEquals("assistant", history.getRole()); assertEquals("agent", history.getSpeaker().getType());
            assertEquals("70", history.getSpeaker().getAgentId());
        }
        assertEquals(2, count("timeline")); assertEquals(2, count("byai_group_human_task"));
    }

    @Test void conflictingExecutionIdentitiesAreRejectedWithoutGuessing() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70),(60,30,40,20,71)");
        JSONObject body = input(); body.put("sourceTaskSessionId", "60");
        assertEquals("HUMAN_TASK_SOURCE_AMBIGUOUS", assertThrows(ResponseStatusException.class,
            () -> local.call(10L, 20L, "createProposal", body)).getReason());
        assertEquals(0, count("byai_group_human_task_batch")); assertEquals(0, count("timeline"));
    }

    @Test void foreignActorGroupAndTenantCannotSupplyTheExecutionIdentity() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70)");
        JSONObject body = input(); body.put("sourceTaskSessionId", "60");
        assertEquals("HUMAN_TASK_SOURCE_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> local.call(10L, 21L, "createProposal", body)).getReason());
        body.put("groupSessionId", "31");
        assertEquals("HUMAN_TASK_SOURCE_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> local.call(10L, 20L, "createProposal", body)).getReason());
        body.put("groupSessionId", "30");
        assertEquals("HUMAN_TASK_GROUP_SCOPE_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> local.call(11L, 20L, "createProposal", body)).getReason());
        assertEquals(0, count("byai_group_human_task_batch"));
    }

    @Test void explicitSourceMessageStillRequiresTheAuthenticatedUserAndGroup() {
        JSONObject body = input(); body.put("sourceMessageId", "41");
        assertEquals("HUMAN_TASK_SOURCE_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> local.call(10L, 20L, "createProposal", body)).getReason());
        assertEquals(0, count("byai_group_human_task_batch"));
    }

    @Test void upgradedSenderColumnsOverrideTheOldPayloadIdentityOnReads() {
        JSONObject batch = assertDoesNotThrow(() -> service.call("createDirect", input()));
        jdbc.update("UPDATE byai_group_human_task_batch SET sender_type='AGENT',sender_id=70");
        JSONObject stored = local.call(10L, 20L, "batch", JSON.parseObject("{\"batchId\":\"" + batch.getString("batchId") + "\"}"));
        assertEquals("AGENT", stored.getString("senderType")); assertEquals("70", stored.getString("senderId"));
    }

    @Test void committedDirectRetryDoesNotRevalidateDepartedMembersOrGroup() {
        JSONObject batch = service.call("createDirect", input());
        when(sessions.findById(30L)).thenReturn(null);
        when(members.findSessionMember(eq(30L), anyString(), anyLong())).thenReturn(null);
        JSONObject replay = assertDoesNotThrow(() -> service.call("createDirect", input()));
        assertEquals(batch.getString("batchId"), replay.getString("batchId"));
        assertEquals(2, replay.getJSONArray("items").size()); assertEquals(1, count("timeline"));
    }

    @Test void canonicalDeadlinesUseUtcMillisecondsAcrossBackends() {
        JSONObject body = input();
        body.getJSONArray("items").getJSONObject(0).put("deadline", "2026-11-13T08:00:00+08:00");
        JSONObject batch = service.call("createDirect", body);
        assertEquals("2026-11-13T00:00:00.000Z", batch.getJSONArray("items").getJSONObject(0).getString("deadline"));
        body.getJSONArray("items").getJSONObject(0).put("deadline", "2026-11-13T00:00:00.000Z");
        assertEquals(batch.getString("batchId"), service.call("createDirect", body).getString("batchId"));
    }

    @Test void sourceExecutionCannotBorrowAnotherTenantsSession() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70)");
        sessions.findById(60L).setEnterpriseId(11L);
        JSONObject body = input(); body.put("sourceTaskSessionId", "60");
        assertEquals("HUMAN_TASK_SOURCE_MISMATCH", assertThrows(ResponseStatusException.class,
            () -> local.call(10L, 20L, "createProposal", body)).getReason());
        assertEquals(0, count("byai_group_human_task_batch"));
    }

    @Test void publicBatchPostCreatesFormalTasksThroughTheAuthenticatedFacade() throws Exception {
        var mvc = org.springframework.test.web.servlet.setup.MockMvcBuilders.standaloneSetup(new HumanTaskController(service)).build();
        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post("/group-human-task-batches")
                .contentType(org.springframework.http.MediaType.APPLICATION_JSON).content(input().toJSONString()))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.status().isOk())
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.status").value("CONFIRMED"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.senderType").value("USER"))
            .andExpect(org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath("$.data.items.length()").value(2));
        assertEquals(1, count("timeline"));
    }

    @Test void newProposalsUseTheCurrentEmployeeNameWithoutChangingExistingSnapshots() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70)");
        SsResource employee = new SsResource(); employee.setResourceName("研究助理");
        when(resources.findById(70L)).thenReturn(employee);
        JSONObject body = input(); body.put("sourceTaskSessionId", "60");
        JSONObject first = local.call(10L, 20L, "createProposal", body);
        employee.setResourceName("项目协调员");
        body.put("requestId", "renamed");
        JSONObject second = local.call(10L, 20L, "createProposal", body);
        assertEquals("研究助理", first.getString("senderName")); assertEquals("项目协调员", second.getString("senderName"));
        JSONObject confirm = new JSONObject(); confirm.put("batchId", first.getString("batchId")); confirm.put("expectedRevision", 0);
        JSONObject confirmed = local.call(10L, 20L, "confirm", confirm);
        JSONObject message = JSON.parseObject(jdbc.queryForObject("SELECT payload FROM timeline WHERE message_id=?", String.class, confirmed.getLong("cardMessageId")));
        assertEquals("研究助理", message.getString("creatorName")); assertEquals("70", message.getString("creatorId"));
    }

    @Test void employeeNameComesFromTheResourceWhenMembershipHasNoName() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70)");
        when(members.findSessionMember(30L, "AGENT", 70L)).thenReturn(new ByaiSessionMember());
        SsResource employee = new SsResource(); employee.setResourceName("产品顾问");
        when(resources.findById(70L)).thenReturn(employee);
        JSONObject body = input(); body.put("sourceTaskSessionId", "60");
        JSONObject batch = local.call(10L, 20L, "createProposal", body);
        assertEquals("产品顾问", batch.getString("senderName"));
        JSONObject message = JSON.parseObject(jdbc.queryForObject("SELECT payload FROM timeline", String.class));
        assertEquals("产品顾问", message.getString("creatorName"));
    }

    @Test void upgradedLegacyProposalsReplayOnlyTheirExactOriginalRequest() {
        jdbc.update("INSERT INTO byai_group_chat_execution VALUES(60,30,40,20,70)");
        String[] requests = {"legacy-user", "legacy-agent"};
        String[] hashes = {"690ca75863f725c7a3a01d63afc13469338e51cec5151b3292bf7822cdd8df4a",
            "3dbae0ea4f434690846f569950fe1160871c7fc455edd8ca63a8bf151a8e35e7"};
        for (int index = 0; index < requests.length; index++) {
            JSONObject original = JSON.parseObject("""
                {"groupSessionId":"30","sourceMessageId":"40","items":[
                    {"title":"Historical","content":"Content","assigneeUserId":"21"}]}
                """);
            original.put("requestId", requests[index]);
            JSONObject historical = JSON.parseObject(original.toJSONString());
            historical.put("batchId", String.valueOf(1000 + index)); historical.put("initiatorUserId", "20");
            historical.put("status", "DRAFT"); historical.put("revision", 0); historical.put("payloadHash", hashes[index]);
            jdbc.update("INSERT INTO byai_group_human_task_batch(batch_id,enterprise_id,group_session_id,initiator_user_id,sender_type,sender_id,source_message_id,request_id,payload_hash,status,revision,payload) VALUES(?,10,30,20,?,?,40,?,?,'DRAFT',0,?)",
                1000 + index, index == 0 ? "USER" : "AGENT", index == 0 ? 20L : 70L, requests[index], hashes[index], historical.toJSONString());
            if (index == 1) {
                // The old Java facade replaced these fields and removed sourceTaskSessionId before hashing.
                original.remove("groupSessionId"); original.remove("sourceMessageId"); original.put("sourceTaskSessionId", "60");
            }
            JSONObject replay = assertDoesNotThrow(() -> local.call(10L, 20L, "createProposal", original));
            assertEquals(String.valueOf(1000 + index), replay.getString("batchId"));
            assertEquals(index == 0 ? "USER" : "AGENT", replay.getString("senderType"));
            JSONObject direct = JSON.parseObject(original.toJSONString()); direct.put("groupSessionId", "30");
            assertEquals("HUMAN_TASK_IDEMPOTENCY_MISMATCH", assertThrows(ResponseStatusException.class,
                () -> local.call(10L, 20L, "createDirect", direct)).getReason());
            original.getJSONArray("items").getJSONObject(0).put("content", "Changed");
            assertEquals("HUMAN_TASK_IDEMPOTENCY_MISMATCH", assertThrows(ResponseStatusException.class,
                () -> local.call(10L, 20L, "createProposal", original)).getReason());
            assertEquals(historical.toJSONString(), jdbc.queryForObject("SELECT payload FROM byai_group_human_task_batch WHERE batch_id=?", String.class, 1000 + index));
        }
        assertEquals(0, count("byai_group_human_task")); assertEquals(0, count("timeline"));
    }
}
