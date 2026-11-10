package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.isNull;

import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.Date;
import java.util.UUID;
import java.util.concurrent.Callable;
import java.util.concurrent.CountDownLatch;
import java.util.concurrent.Executors;
import java.util.concurrent.TimeUnit;
import java.util.concurrent.atomic.AtomicLong;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.mockito.ArgumentCaptor;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.data.redis.connection.RedisClusterConfiguration;
import org.springframework.data.redis.connection.RedisStandaloneConfiguration;
import org.springframework.data.redis.connection.jedis.JedisConnectionFactory;
import org.springframework.integration.redis.util.RedisLockRegistry;
import org.springframework.scheduling.concurrent.ThreadPoolTaskScheduler;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.lock.RedisTransactionLockInterceptor;
import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.common.message.service.ByaiMessageHotService;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.application.service.session.SessionApplicationService;
import com.iwhalecloud.byai.state.application.service.chat.OpenApiConversationApplicationService;
import com.iwhalecloud.byai.state.application.service.chat.ChatFileArtifactApplicationService;
import com.iwhalecloud.byai.state.domain.chat.dto.ChatFileArtifactResolveRequest;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.state.interfaces.controller.chat.AssistantChatController;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTaskPublicationMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatPendingPublicationMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatForwardSourceMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatForwardMapper;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatApplicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatPendingPublicationStore;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskChatGuard;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTaskService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatTaskAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatPendingPublicationRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskCompleteRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatTaskPublicationResponse;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatAgentMentionParser;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.LegacyForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardActor;
import com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.ws.service.MultiDeviceBroadcastService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionMemberService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

/** 使用独立数据库事务运行开聊服务和真实 Mapper，覆盖历史重复、并发开聊及列表可见性。 */
class GroupChatDirectConversationTest extends I18nTestSupport {
    private JdbcTemplate db;
    private TransactionTemplate transaction;
    private GroupChatApplicationService groups;
    private GroupChatTaskService taskService;
    private GroupChatPendingPublicationService drafts;
    private GroupChatTaskChatGuard guard;
    private final GroupChatEventPublisher events = mock(GroupChatEventPublisher.class);
    private LegacyForwardSourceAuthorityReader forwardSources;
    private GroupChatTaskAuthorizationService taskAuthorization;
    private SessionService sessions;
    private ByaiGroupChatTaskMapper directMapper;
    private JedisConnectionFactory redis;
    private RedisLockRegistry locks;
    private ThreadPoolTaskScheduler scheduler;

    @BeforeEach
    void setUp() {
        var ds = new DriverManagerDataSource("jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1");
        db = new JdbcTemplate(ds);
        transaction = new TransactionTemplate(new DataSourceTransactionManager(ds));
        db.execute("""
            CREATE TABLE byai_group_chat_task (
                task_session_id BIGINT PRIMARY KEY, group_session_id BIGINT, source_message_id BIGINT,
                dispatch_id BIGINT UNIQUE, initiator_user_id BIGINT, target_agent_id BIGINT, task_name VARCHAR,
                status VARCHAR, turn_status VARCHAR, current_turn_id BIGINT, current_turn_trace_id VARCHAR,
                publish_message_id BIGINT, publish_by BIGINT, create_time TIMESTAMP, update_time TIMESTAMP)
            """);
        db.execute("""
            CREATE TABLE byai_group_chat_direct_binding (
                group_session_id BIGINT, initiator_user_id BIGINT, target_agent_id BIGINT, task_session_id BIGINT UNIQUE,
                PRIMARY KEY (group_session_id, initiator_user_id, target_agent_id))
            """);
        db.execute("""
            CREATE TABLE byai_session (session_id BIGINT PRIMARY KEY, parent_session_id BIGINT, creator_id BIGINT,
                object_id BIGINT, session_type VARCHAR, state VARCHAR, update_time TIMESTAMP, create_time TIMESTAMP)
            """);
        db.execute("CREATE TABLE byai_session_ext(session_id BIGINT, ext_param_code VARCHAR, ext_param_value VARCHAR)");
        db.execute("CREATE TABLE byai_group_chat_execution(candidate_session_id BIGINT)");
        db.execute("CREATE TABLE byai_group_chat_turn(candidate_session_id BIGINT, gateway_session_id VARCHAR)");
        db.execute("CREATE TABLE byai_session_member (session_id BIGINT, mem_obj_type VARCHAR, mem_obj_id BIGINT)");
        db.execute("CREATE TABLE byai_message (message_id BIGINT, session_id BIGINT, creator_id BIGINT, create_time TIMESTAMP)");
        db.execute("""
            CREATE TABLE byai_group_chat_pending_publication (task_session_id BIGINT PRIMARY KEY,
                pending_publication_id BIGINT UNIQUE, text_content VARCHAR, source_files_json VARCHAR,
                uploaded_files_json VARCHAR, cloud_resource_id BIGINT, create_time TIMESTAMP)
            """);
        db.execute("""
            CREATE TABLE byai_group_chat_private_publication (task_session_id BIGINT, pending_publication_id BIGINT,
                group_session_id BIGINT, message_id BIGINT UNIQUE, publisher_user_id BIGINT, text_content VARCHAR,
                files_json VARCHAR, create_time TIMESTAMP, PRIMARY KEY(task_session_id, pending_publication_id))
            """);
        db.execute("""
            CREATE TABLE public_message (id BIGINT PRIMARY KEY, group_id BIGINT, agent_id BIGINT, topic BIGINT,
                reply_to BIGINT, content VARCHAR, metadata VARCHAR)
            """);
        db.execute("INSERT INTO byai_session(session_id, session_type) VALUES (10, 'hs_as'), (11, 'hs_as')");
        var config = new MybatisConfiguration(new Environment("direct", new SpringManagedTransactionFactory(), ds));
        config.setMapUnderscoreToCamelCase(true);
        configureRedis(config);
        config.addMapper(ByaiSessionMapper.class);
        config.addMapper(ByaiGroupChatTaskMapper.class);
        config.addMapper(ByaiGroupChatPendingPublicationMapper.class);
        config.addMapper(ByaiGroupChatTaskPublicationMapper.class);
        var sql = new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(config));
        var mapper = sql.getMapper(ByaiGroupChatTaskMapper.class);
        directMapper = mapper;
        sessions = mock(SessionService.class);
        when(sessions.findById(anyLong())).thenAnswer(call -> db.query("SELECT * FROM byai_session WHERE session_id = ?",
            (row, i) -> {
                ByaiSession session = new ByaiSession();
                session.setSessionId(row.getLong("session_id"));
                session.setCreatorId(row.getObject("creator_id", Long.class));
                session.setParentSessionId(row.getObject("parent_session_id", Long.class));
                session.setObjectId(row.getObject("object_id", Long.class));
                session.setSessionType(row.getString("session_type"));
                session.setProjectId(20L);
                session.setEnterpriseId(1L);
                return session;
            }, (Long) call.getArgument(0)).stream().findFirst().orElse(null));
        when(sessions.lockById(anyLong())).thenAnswer(call -> {
            Long id = call.getArgument(0);
            if (redis != null) {
                sql.getMapper(ByaiSessionMapper.class).serializeById(id);
            } else {
                // 无 Redis 的默认测试用事务级行更新模拟群锁的持有期限。
                db.update("UPDATE byai_session SET session_id = session_id WHERE session_id = ?", id);
            }
            return sessions.findById(id);
        });
        when(sessions.save(any())).thenAnswer(call -> {
            ByaiSession session = call.getArgument(0);
            db.update("INSERT INTO byai_session(session_id,parent_session_id,creator_id,object_id,session_type) "
                + "VALUES (?, ?, ?, ?, ?)", session.getSessionId(),
                session.getParentSessionId(), session.getCreatorId(), session.getObjectId(), session.getSessionType());
            return session;
        });
        SessionMemberService members = mock(SessionMemberService.class);
        when(members.findSessionMember(anyLong(), any(), anyLong())).thenAnswer(call -> {
            Long id = call.getArgument(2);
            if (!List.of(30L, 31L, 40L, 41L).contains(id)) return null;
            ByaiSessionMember member = new ByaiSessionMember();
            member.setMemObjId(id);
            member.setMemObjType(call.getArgument(1));
            member.setMemName("member-" + id);
            return member;
        });
        var extensions = mock(SessionExtService.class);
        doAnswer(call -> {
            ByaiSessionExt ext = call.getArgument(0);
            db.update("INSERT INTO byai_session_ext VALUES (?, ?, ?)", ext.getSessionId(), ext.getExtParamCode(), ext.getExtParamValue());
            return null;
        }).when(extensions).save(any());
        var authorization = new GroupChatAuthorizationService(sessions, members, extensions);
        var sequence = mock(SequenceService.class);
        AtomicLong ids = new AtomicLong(1000L);
        when(sequence.nextVal()).thenAnswer(call -> ids.incrementAndGet());
        var messages = mock(ByaiMessageMapper.class);
        when(messages.selectByMessageId(anyLong())).thenAnswer(call -> db.query(
            "SELECT * FROM public_message WHERE id = ?", (row, index) -> {
                ByaiMessage message = new ByaiMessage();
                message.setSessionId(row.getLong("group_id"));
                message.setMessageId(row.getLong("id"));
                message.setCreatorId(row.getLong("agent_id"));
                message.setUsage(2);
                message.setCreateTime(new Date());
                message.setMetadata(row.getString("metadata"));
                message.setMessageContent(row.getString("content"));
                return message;
            }, (Long)call.getArgument(0)).stream().findFirst().orElse(null));
        when(messages.insert(any(ByaiMessage.class))).thenAnswer(call -> {
            ByaiMessage message = call.getArgument(0);
            return db.update("INSERT INTO public_message VALUES (?, ?, ?, ?, ?, ?, ?)", message.getMessageId(),
                message.getSessionId(), message.getCreatorId(), message.getTopicId(), message.getMessageRef(),
                message.getMessageContent(), message.getMetadata());
        });
        groups = new GroupChatApplicationService(sessions, sequence, authorization, members, null, null,
            messages, null, null, extensions);
        ReflectionTestUtils.setField(groups, "groupChatTaskMapper", mapper);
        var permissions = mock(ResourceAuthContextService.class);
        when(permissions.getAuthContextBo()).thenReturn(new AuthContextBo(Set.of(40L, 41L), Map.of()));
        var resources = mock(SsResourceService.class);
        when(resources.findById(40L)).thenReturn(new SsResource());
        taskAuthorization = new GroupChatTaskAuthorizationService(mapper, authorization, members, permissions, resources);
        var store = new GroupChatPendingPublicationStore(sql.getMapper(ByaiGroupChatPendingPublicationMapper.class),
            mock(MultiDeviceBroadcastService.class));
        drafts = new GroupChatPendingPublicationService(taskAuthorization, mapper, store, sequence);
        taskService = new GroupChatTaskService(mapper, sql.getMapper(ByaiGroupChatTaskPublicationMapper.class), null,
            messages, sequence, null, taskAuthorization, authorization, sessions, null, resources,
            events, store, null, null);
        ReflectionTestUtils.setField(taskService, "mentionParser", new GroupChatAgentMentionParser(members, null, resources, null));
        ReflectionTestUtils.setField(taskService, "topicService", new GroupChatTopicService(messages, null, sessions));
        ReflectionTestUtils.setField(taskService, "transactionManager", transaction.getTransactionManager());
        guard = new GroupChatTaskChatGuard(mapper, taskAuthorization, taskService, null);
        forwardSources = new LegacyForwardSourceAuthorityReader(sessions, members, messages, mapper,
            sql.getMapper(ByaiGroupChatTaskPublicationMapper.class), sql.getMapper(ByaiGroupChatPendingPublicationMapper.class),
            mock(ByaiGroupChatForwardSourceMapper.class), mock(ByaiGroupChatForwardMapper.class));
    }

    @AfterEach
    void clear() {
        CurrentUserHolder.clearLoginInfo();
        db.execute("SHUTDOWN");
        if (locks != null) locks.destroy();
        if (scheduler != null) scheduler.shutdown();
        if (redis != null) redis.destroy();
    }

    /** 可选本机 Redis 测试使用生产 Mapper 锁拦截器和独立键前缀。 */
    private void configureRedis(MybatisConfiguration config) {
        String mode = System.getProperty("byclaw.direct-test.redis");
        if (mode == null) return;
        redis = switch (mode) {
            case "standalone" -> new JedisConnectionFactory(new RedisStandaloneConfiguration("127.0.0.1",
                Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_PORT"))));
            case "cluster" -> new JedisConnectionFactory(new RedisClusterConfiguration(
                List.of("127.0.0.1:" + Integer.parseInt(System.getenv("BYCLAW_TEST_REDIS_CLUSTER_PORT")))));
            default -> throw new IllegalArgumentException("Unknown test Redis mode: " + mode);
        };
        redis.afterPropertiesSet();
        redis.start();
        scheduler = new ThreadPoolTaskScheduler();
        scheduler.setDaemon(true);
        scheduler.initialize();
        locks = new RedisLockRegistry(redis, "test:direct:" + UUID.randomUUID(), 60_000L);
        locks.setRenewalTaskScheduler(scheduler);
        config.addInterceptor(new RedisTransactionLockInterceptor(new TransactionalRedisLockService(locks)));
    }

    @Test
    void unscopedHistoryIncludesOnlyReadablePrivateMessagesBeforePagination() {
        historical(60L, 30L, "PRIVATE", "2025-01-01");
        db.execute("INSERT INTO byai_session(session_id,parent_session_id,creator_id,object_id,session_type) VALUES (62,10,31,40,'h_as')");
        db.execute("INSERT INTO byai_session_ext VALUES (62,'group_source_session_id','10')");
        db.execute("INSERT INTO byai_message VALUES (1,10,30,CURRENT_TIMESTAMP),(2,60,40,CURRENT_TIMESTAMP),(3,62,40,CURRENT_TIMESTAMP)");
        db.execute("INSERT INTO byai_session_member VALUES (10,'USER',30),(10,'USER',31)");
        MessageHotPageQo all = new MessageHotPageQo();
        assertThat(directMapper.selectReadableHistoryPage(all, 30L)).extracting(ByaiMessage::getMessageId).containsExactly(2L, 1L);
        assertThat(directMapper.selectReadableHistoryPage(all, 31L)).extracting(ByaiMessage::getMessageId).containsExactly(3L, 1L);
        db.execute("DELETE FROM byai_session_member WHERE mem_obj_id=30");
        assertThat(directMapper.selectReadableHistoryPage(all, 30L)).extracting(ByaiMessage::getMessageId).containsExactly(1L);
        all.setCreatorId(40L);
        assertThat(directMapper.selectReadableHistoryPage(all, 31L)).extracting(ByaiMessage::getMessageId).containsExactly(3L);
    }

    @Test
    void confirmationsReturnTheirOwnReceiptAcrossLaterDraftsAndConcurrentRetries() throws Exception {
        historical(60L, 30L, "PRIVATE", "2025-01-01");
        open(10L, 30L, 40L);
        Long outdated = prepare("私下修订前");
        Long first = prepare("同意发布的第一条");
        assertThatThrownBy(() -> confirm(outdated)).isInstanceOf(IllegalArgumentException.class);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM public_message", Integer.class)).isZero();
        CountDownLatch start = new CountDownLatch(1);
        Callable<GroupChatTaskPublicationResponse> publish = () -> {
            login(30L);
            try { start.await(); return confirm(first); }
            finally { CurrentUserHolder.clearLoginInfo(); }
        };
        GroupChatTaskPublicationResponse published;
        try (var pool = Executors.newFixedThreadPool(2)) {
            var a = pool.submit(publish);
            var b = pool.submit(publish);
            start.countDown();
            published = a.get(10, TimeUnit.SECONDS);
            assertThat(b.get(10, TimeUnit.SECONDS)).isEqualTo(published);
        }
        assertThat(drafts.current(60L)).isNull();
        Long second = prepare("同意发布的第二条");
        assertThat(confirm(first)).isEqualTo(published);
        assertThat(drafts.current(60L).getPendingPublicationId()).isEqualTo(second);
        assertThat(confirm(second).getMessageId()).isNotEqualTo(published.getMessageId());
        assertThat(confirm(first)).isEqualTo(published);
        assertThat(db.queryForList("SELECT content FROM public_message ORDER BY id", String.class))
            .containsExactly("同意发布的第一条", "同意发布的第二条");
        assertThat(db.queryForObject("""
            SELECT COUNT(*) FROM public_message WHERE topic = id AND reply_to IS NULL
                AND group_id = 10 AND agent_id = 40 AND metadata NOT LIKE '%sourceMessageId%' AND metadata NOT LIKE '%"taskId"%'
            """, Integer.class)).isEqualTo(2);
        var sent = ArgumentCaptor.forClass(JSONObject.class);
        verify(events, times(2)).publish(eq(10L), sent.capture(), isNull());
        assertThat(sent.getAllValues()).allSatisfy(event -> {
            assertThat(event.getString("event")).isEqualTo("MESSAGE_CREATED");
            assertThat(event).doesNotContainKeys("taskId", "replyTo", "sourceMessageId", "initiatorUserId");
        });
        var member = new ForwardActor(31L, 1L);
        assertThat(forwardSources.readMessage(member, 10L, published.getMessageId()).content()).isEqualTo("同意发布的第一条");
        assertThatThrownBy(() -> forwardSources.readMessage(member, 11L, published.getMessageId())).isInstanceOf(IllegalArgumentException.class);
        assertThat(guard.beforeTurn(60L, 40L, null)).isNull();
        assertThatThrownBy(() -> taskService.cancel(60L)).isInstanceOf(IllegalArgumentException.class);
        assertThat(taskService.detail(60L).getStatus()).isEqualTo("PRIVATE");
        login(31L);
        assertThatThrownBy(() -> confirm(first)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> drafts.current(60L)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void privateHistoryCannotBeReadOrDeletedThroughGenericConversationApis() {
        historical(60L, 30L, "PRIVATE", "2025-01-01");
        ByaiMessageHotDto message = new ByaiMessageHotDto();
        message.setSessionId(60L);
        message.setMessageId(900L);
        message.setMessageContent("never-public-text");
        var hot = mock(ByaiMessageHotService.class);
        when(hot.findById(900L)).thenReturn(message);
        when(hot.findByQo(any())).thenReturn(List.of(message));
        MessageService reads = new MessageService();
        ReflectionTestUtils.setField(reads, "sessionService", sessions);
        ReflectionTestUtils.setField(reads, "byaiMessageHotService", hot);
        ReflectionTestUtils.setField(reads, "groupTaskAccess", taskAuthorization);
        var controller = new AssistantChatController();
        ReflectionTestUtils.setField(controller, "byaiMessageHotService", hot);
        ReflectionTestUtils.setField(controller, "groupTaskAccess", taskAuthorization);
        var openApi = new OpenApiConversationApplicationService();
        ReflectionTestUtils.setField(openApi, "byaiMessageHotService", hot);
        ReflectionTestUtils.setField(openApi, "groupTaskAccess", taskAuthorization);
        var remove = new SessionApplicationService();
        ReflectionTestUtils.setField(remove, "groupTaskAccess", taskAuthorization);
        var query = new MessageQo();
        query.setSessionId(60L);
        query.setMessageIds(List.of(900L));
        var page = new MessageHotPageQo();
        page.setSessionId(60L);
        login(31L);
        assertThatThrownBy(() -> reads.getConversationOutline(query)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reads.getMessages(query)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reads.getMessageByIds(query)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> reads.getForwardMessages(900L)).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> controller.getMessageById("900")).isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> openApi.qryMessagesByQo(page)).isInstanceOf(IllegalArgumentException.class);
        // 即使当前用户有普通项目文件的管理权限，私聊附件仍须单独校验来源会话。
        CurrentUserHolder.getLoginInfo().setUserCode("adminvip");
        var files = new ChatFileArtifactApplicationService(sessions, null, null, null, null, null, null);
        ReflectionTestUtils.setField(files, "groupTaskAccess", taskAuthorization);
        var fileRequest = new ChatFileArtifactResolveRequest();
        fileRequest.setSessionId(60L);
        assertThatThrownBy(() -> files.resolve(fileRequest)).isInstanceOf(IllegalArgumentException.class);
        CurrentUserHolder.clearLoginInfo();
        assertThat(reads.getMessageContent(900L, 1)).doesNotContain("never-public-text");
        login(30L);
        assertThat(reads.getMessageByIds(query)).containsExactly(message);
        assertThatThrownBy(() -> remove.removeConversation(60L)).isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void failedPublicMessageRollsBackItsReceiptAndLeavesTheCardRetryable() {
        historical(60L, 30L, "PRIVATE", "2025-01-01");
        open(10L, 30L, 40L);
        Long id = prepare("恢复后发布");
        db.execute("ALTER TABLE public_message ADD CONSTRAINT test_reject CHECK (content <> '恢复后发布')");
        assertThatThrownBy(() -> confirm(id)).isInstanceOf(org.springframework.dao.DataIntegrityViolationException.class);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_group_chat_private_publication", Integer.class)).isZero();
        assertThat(drafts.current(60L).getPendingPublicationId()).isEqualTo(id);
        db.execute("ALTER TABLE public_message DROP CONSTRAINT test_reject");
        assertThat(confirm(id).getText()).isEqualTo("恢复后发布");
        assertThat(db.queryForObject("SELECT COUNT(*) FROM public_message", Integer.class)).isEqualTo(1);
    }

    @Test
    void supersededPrivateSessionsKeepReadableHistoryButCannotAcceptNewWork() {
        historical(60L, 30L, "PRIVATE", "2025-01-01");
        historical(62L, 30L, "PRIVATE", "2025-01-02");
        Long canonical = open(10L, 30L, 40L);
        assertThat(canonical).isEqualTo(60L);
        assertThat(taskService.detail(62L).getTaskSessionId()).isEqualTo(62L);
        var request = new GroupChatPendingPublicationRequest();
        request.setText("不可从旧入口发布");
        assertThatThrownBy(() -> transaction.execute(status -> drafts.prepare(62L, request)))
            .isInstanceOf(IllegalArgumentException.class);
        assertThatThrownBy(() -> guard.beforeTurn(62L, 40L, null)).isInstanceOf(IllegalArgumentException.class);
        assertThat(drafts.current(62L)).isNull();
        assertThat(guard.beforeTurn(canonical, 40L, null)).isNull();
    }

    @Test
    void onlyPreviouslyCancelledPrivateHistoryMayBeRestored() {
        historical(60L, 30L, "PRIVATE", "2025-01-01");
        historical(62L, 30L, "ACTIVE", "2024-01-01");
        db.execute("UPDATE byai_group_chat_task SET status = 'CANCELLED'");
        db.execute("UPDATE byai_session SET state = 'CLOSED' WHERE session_id = 60");
        assertThat(open(10L, 30L, 40L)).isEqualTo(60L);
        assertThat(taskService.detail(60L).getStatus()).isEqualTo("PRIVATE");
        assertThat(taskService.detail(62L).getStatus()).isEqualTo("CANCELLED");
        assertThat(db.queryForObject("SELECT state FROM byai_session WHERE session_id = 60", String.class)).isEqualTo("ACTIVE");
    }

    private Long prepare(String text) {
        var request = new GroupChatPendingPublicationRequest();
        request.setText(text);
        return transaction.execute(status -> drafts.prepare(60L, request).getPendingPublicationId());
    }

    private GroupChatTaskPublicationResponse confirm(Long pendingId) {
        var request = new GroupChatTaskCompleteRequest();
        request.setPendingPublicationId(pendingId);
        return transaction.execute(status -> taskService.complete(60L, request));
    }

    @Test
    void bothOpenRoutesRecoverTheEarliestLegacyDirectSessionWithoutAdoptingCandidateHistory() {
        for (long id : List.of(60L, 61L, 62L, 63L)) {
            db.update("INSERT INTO byai_session(session_id,parent_session_id,creator_id,object_id,session_type,create_time) "
                + "VALUES (?,10,30,40,'h_as',CURRENT_TIMESTAMP)", id);
        }
        for (long id : List.of(60L, 62L, 63L)) db.update("INSERT INTO byai_session_ext VALUES (?, 'group_source_session_id', '10')", id);
        db.execute("INSERT INTO byai_group_chat_execution VALUES (60)");
        login(30L);
        assertThat(transaction.execute(status -> groups.createDirectSession(10L, 40L)).getSessionId()).isEqualTo(62L);
        assertThat(open(10L, 30L, 40L)).isEqualTo(62L);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_group_chat_direct_binding", Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_session", Integer.class)).isEqualTo(6);
    }

    @Test
    void repeatedAndConcurrentOpensAreScopedToTheGroupUserAndEmployee() throws Exception {
        CountDownLatch start = new CountDownLatch(1);
        Callable<Long> open = () -> {
            start.await();
            try { return open(10L, 30L, 40L); }
            finally { CurrentUserHolder.clearLoginInfo(); }
        };
        try (var pool = Executors.newFixedThreadPool(2)) {
            var first = pool.submit(open);
            var second = pool.submit(open);
            start.countDown();
            Long id = first.get(10, TimeUnit.SECONDS);
            assertThat(second.get(10, TimeUnit.SECONDS)).isEqualTo(id);
            assertThat(open(10L, 30L, 40L)).isEqualTo(id);
            assertThat(open(10L, 30L, 41L)).isNotEqualTo(id);
            assertThat(open(10L, 31L, 40L)).isNotEqualTo(id);
            assertThat(open(11L, 30L, 40L)).isNotEqualTo(id);
        }
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_session WHERE parent_session_id IS NOT NULL",
            Integer.class)).isEqualTo(4);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_group_chat_direct_binding", Integer.class)).isEqualTo(4);
    }

    @Test
    void existingDuplicatesKeepHistoryButOnlyTheEarliestPrivateEntryIsListedAndReopened() {
        historical(60L, 30L, "PRIVATE", "2025-01-02");
        historical(65L, 30L, "PRIVATE", "2025-01-01");
        historical(62L, 30L, "PRIVATE", "2025-01-01");
        historical(66L, 31L, "PRIVATE", "2025-01-01");
        historical(70L, 31L, "ACTIVE", "2025-01-03");
        login(30L);
        assertThat(taskService.list(10L)).extracting(ByaiGroupChatTask::getTaskSessionId).containsExactly(70L, 62L);
        assertThat(open(10L, 30L, 40L)).isEqualTo(62L);
        historical(64L, 30L, "PRIVATE", "2024-12-31");
        assertThat(open(10L, 30L, 40L)).isEqualTo(62L);
        assertThat(taskService.list(10L)).extracting(ByaiGroupChatTask::getTaskSessionId).containsExactly(70L, 62L);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_group_chat_task", Integer.class)).isEqualTo(6);
    }

    @Test
    void reopeningStillRequiresBothMembers() {
        open(10L, 30L, 40L);
        assertThatThrownBy(() -> open(10L, 32L, 40L)).isInstanceOf(RuntimeException.class);
        assertThatThrownBy(() -> open(10L, 30L, 42L)).isInstanceOf(IllegalArgumentException.class);
        assertThat(db.queryForObject("SELECT COUNT(*) FROM byai_group_chat_task", Integer.class)).isEqualTo(1);
    }

    private void historical(Long id, Long user, String status, String created) {
        db.update("INSERT INTO byai_session(session_id,parent_session_id,creator_id,object_id,session_type) "
            + "VALUES (?, 10, ?, 40, 'h_as')", id, user);
        db.update("""
            INSERT INTO byai_group_chat_task(task_session_id, group_session_id, source_message_id, dispatch_id,
                initiator_user_id, target_agent_id, status, turn_status, create_time)
            VALUES (?, 10, 55, ?, ?, 40, ?, ?, CAST(? AS TIMESTAMP))
            """, id, id, user, status, status.equals("PRIVATE") ? "PRIVATE" : "WAITING_USER", created);
    }

    private Long open(Long group, Long user, Long agent) {
        login(user);
        return transaction.execute(status -> groups.createDirectTask(group, agent).getTaskSessionId());
    }

    private void login(Long user) {
        LoginInfo login = new LoginInfo();
        login.setUserId(user);
        CurrentUserHolder.setLoginInfo(login);
    }
}
