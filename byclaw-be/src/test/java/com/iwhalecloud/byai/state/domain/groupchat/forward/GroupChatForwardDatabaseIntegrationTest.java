package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.*;
import com.iwhalecloud.byai.manager.mapper.groupchat.*;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.session.ByaiSessionMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.GroupChatEventPublisher;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.LegacyForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.net.URI;
import java.nio.file.*;
import java.sql.*;
import java.time.*;
import java.util.*;
import java.util.concurrent.*;
import java.util.concurrent.atomic.*;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.junit.jupiter.api.*;
import org.junit.jupiter.api.condition.EnabledIfEnvironmentVariable;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.jdbc.core.*;
import org.springframework.jdbc.datasource.*;
import org.springframework.test.util.ReflectionTestUtils;

/** Actual PG connections and production final publisher/recall/remove services; no H2 concurrency claim. */
@EnabledIfEnvironmentVariable(named="FORWARD_TEST_PG",matches=".+")
class GroupChatForwardDatabaseIntegrationTest {
    DriverManagerDataSource ds;JdbcTemplate db;DataSourceTransactionManager manager;
    LegacyGroupChatForwardStore store;ByaiGroupChatForwardMapper rows;
    GroupChatForwardCommitService commits;GroupChatMessageRecallService recalls;GroupChatApplicationService groups;
    AtomicReference<Runnable> beforePublish=new AtomicReference<>();
    final ForwardActor actor=new ForwardActor(30,1);

    @BeforeEach void setup() throws Exception {
        var uri=URI.create(System.getenv("FORWARD_TEST_PG"));
        assertThat(uri.getHost()).isEqualTo("127.0.0.1");assertThat(uri.getPort()).isEqualTo(15486);assertThat(uri.getPath()).isEqualTo("/byclaw_forward_test");
        ds=new DriverManagerDataSource("jdbc:postgresql://127.0.0.1:15486/byclaw_forward_test?currentSchema=byai","postgres","");db=new JdbcTemplate(ds);manager=new DataSourceTransactionManager(ds);
        db.execute("DROP SCHEMA IF EXISTS byai CASCADE");db.execute(Files.readString(Path.of("../deploy/migrations/versions/V0.6.0/tenant/V0.6.0__baseline__ddl.sql")));
        db.execute("INSERT INTO byai.byai_session(session_id,enterprise_id,session_type,state,creator_id) VALUES(10,1,'hs_as','ACTIVE',31),(20,1,'hs_as','ACTIVE',31)");
        for(long group:List.of(10L,20L))for(long user:List.of(30L,31L))db.update("INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id,user_role,mem_name) VALUES(?,?,'USER',?,1,?,?)",group*100+user,group,user,user==31?"OWNER":"MEMBER",user==31?"Admin":"Human");
        for(long id:List.of(101L,102L,201L))db.update("INSERT INTO byai.byai_message(id,message_id,enterprise_id,session_id,usage,creator_id,creator_name,message_content,create_time) VALUES(?,?,1,?,1,30,'Human',?,CURRENT_TIMESTAMP)",id,id,id==201?20:10,id==102?"second":"first");
        var config=new MybatisConfiguration();config.setMapUnderscoreToCamelCase(true);config.setLocalCacheScope(org.apache.ibatis.session.LocalCacheScope.STATEMENT);config.setEnvironment(new Environment("fixture",new SpringManagedTransactionFactory(),ds));
        config.addMapper(ByaiGroupChatForwardMapper.class);config.addMapper(ByaiSessionMapper.class);config.addMapper(ByaiMessageMapper.class);
        var session=new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(config));rows=session.getMapper(ByaiGroupChatForwardMapper.class);
        var sessions=spy(new SessionService());ReflectionTestUtils.setField(sessions,"byaiSessionMapper",session.getMapper(ByaiSessionMapper.class));
        doAnswer(i->{var found=db.query("SELECT * FROM byai.byai_session WHERE session_id=?",new BeanPropertyRowMapper<>(ByaiSession.class),(Object)i.getArgument(0));return found.isEmpty()?null:found.getFirst();}).when(sessions).findById(anyLong());
        var members=mock(SessionMemberService.class);
        when(members.findSessionMember(anyLong(),eq("USER"),anyLong())).thenAnswer(i->{var found=db.query("SELECT * FROM byai.byai_session_member WHERE session_id=? AND mem_obj_type='USER' AND mem_obj_id=?",new BeanPropertyRowMapper<>(ByaiSessionMember.class),i.getArgument(0),i.getArgument(2));return found.isEmpty()?null:found.getFirst();});
        doAnswer(i->{db.update("DELETE FROM byai.byai_session_member WHERE byai_session_member_id=?",(Object)i.getArgument(0));return null;}).when(members).deleteMember(anyLong());
        var realMessages=session.getMapper(ByaiMessageMapper.class);var messages=mock(ByaiMessageMapper.class);
        when(messages.selectByMessageId(anyLong())).thenAnswer(i->realMessages.selectByMessageId(i.getArgument(0)));
        when(messages.selectForRecall(anyLong(),anyLong())).thenAnswer(i->realMessages.selectForRecall(i.getArgument(0),i.getArgument(1)));
        when(messages.recallGroupMessage(anyLong(),anyLong(),anyLong(),any())).thenAnswer(i->realMessages.recallGroupMessage(i.getArgument(0),i.getArgument(1),i.getArgument(2),i.getArgument(3)));
        // Observe the first publisher INSERT after all production eligibility checks; SQL and rollback remain real.
        when(messages.insert(any(ByaiMessage.class))).thenAnswer(i->{ByaiMessage m=i.getArgument(0);if(m.getUsage()==1){var gate=beforePublish.getAndSet(null);if(gate!=null)gate.run();}return db.update("INSERT INTO byai.byai_message(id,message_id,enterprise_id,session_id,usage,creator_id,creator_name,message_content,create_time,topic_id,metadata,related_resources) VALUES(?,?,?,?,?,?,?,?,?,?,?,?)",m.getId(),m.getMessageId(),m.getEnterpriseId(),m.getSessionId(),m.getUsage(),m.getCreatorId(),m.getCreatorName(),m.getMessageContent(),m.getCreateTime(),m.getTopicId(),m.getMetadata(),m.getRelatedResources());});
        var source=new LegacyForwardSourceAuthorityReader(sessions,members,messages,mock(ByaiGroupChatTaskMapper.class),mock(ByaiGroupChatTaskPublicationMapper.class),mock(ByaiGroupChatPendingPublicationMapper.class),mock(ByaiGroupChatForwardSourceMapper.class),rows);
        var sequence=mock(SequenceService.class);var ids=new AtomicLong(1000);when(sequence.nextVal()).thenAnswer(i->ids.incrementAndGet());var props=new GroupChatForwardProperties();var json=new ObjectMapper().findAndRegisterModules();var policy=mock(ForwardPlatformPolicy.class);var locations=new ForwardUploadReservation(props);
        store=new LegacyGroupChatForwardStore(rows,db,manager,json,sequence,sessions,members,source,policy,locations,props);
        var topics=new GroupChatTopicService(messages,mock(ByaiGroupChatTopicMapper.class),sessions);
        commits=proxy(new GroupChatForwardCommitService(store,rows,db,manager,json,sequence,topics,policy,locations,props));
        var authorization=new GroupChatAuthorizationService(sessions,members,mock(SessionExtService.class));var events=mock(GroupChatEventPublisher.class);
        var recall=new GroupChatMessageRecallService(authorization,topics,messages,events);ReflectionTestUtils.setField(recall,"cancellations",mock(GroupChatRecallCancellationService.class));recalls=proxy(recall);
        groups=proxy(new GroupChatApplicationService(sessions,sequence,authorization,members,null,null,messages,null,events,mock(SessionExtService.class)));
    }
    @SuppressWarnings("unchecked") <T>T proxy(T target){var advice=new TransactionAdviceConfig();ReflectionTestUtils.setField(advice,"transactionManager",manager);var factory=new ProxyFactory(target);factory.setProxyTargetClass(true);factory.addAdvice(advice.getAdvisor());return (T)factory.getProxy();}
    TargetLease ready(long source,long target,List<Long> ids,String key){var operation=store.prepare(actor,source,new ForwardInput(key,ForwardMode.SINGLE,ids,List.of(target)));var locator=new ForwardOperationLocator(1,operation.requestId(),ForwardBackend.LEGACY);store.freezeSources(store.claimRequest(locator,"resolve",Duration.ofMinutes(1)),new FreezeCompletion(List.of(),List.of()));return store.markReady(store.claimTarget(locator,rows.targets(1L,operation.requestId()).getFirst().getTargetId(),"worker",Duration.ofMinutes(1)));}
    TargetLease ready(){return ready(10,20,List.of(101L,102L),"key");}
    void mutate(String kind){var login=new LoginInfo();login.setUserId("recall".equals(kind)?30L:31L);login.setEnterpriseId(1L);CurrentUserHolder.setLoginInfo(login);try{if("recall".equals(kind))recalls.recall(10L,101L);else groups.remove(10L,"USER",30L);}finally{CurrentUserHolder.clearLoginInfo();}}
    void await(java.util.function.BooleanSupplier condition)throws Exception{long until=System.nanoTime()+TimeUnit.SECONDS.toNanos(4);while(!condition.getAsBoolean()&&System.nanoTime()<until)Thread.sleep(10);assertThat(condition.getAsBoolean()).isTrue();}
    @Test void oppositeDirectionsBothCommitWithoutDeadlock()throws Exception{var a=ready();var b=ready(20,10,List.of(201L),"reverse");try(var workers=Executors.newFixedThreadPool(2)){var left=workers.submit(()->commits.commit(a));var right=workers.submit(()->commits.commit(b));assertThat(left.get(5,TimeUnit.SECONDS).messageIds()).hasSize(2);assertThat(right.get(5,TimeUnit.SECONDS).messageIds()).hasSize(1);}}
    @ParameterizedTest @ValueSource(strings={"recall","remove"}) void actualLifecycleWriterWaitsAfterFinalValidation(String kind)throws Exception{
        var lease=ready();var reached=new CountDownLatch(1);var release=new CountDownLatch(1);var pid=new AtomicInteger();
        beforePublish.set(()->{pid.set(db.queryForObject("SELECT pg_backend_pid()",Integer.class));reached.countDown();try{assertThat(release.await(5,TimeUnit.SECONDS)).isTrue();}catch(InterruptedException e){Thread.currentThread().interrupt();throw new RuntimeException(e);}});
        try(var workers=Executors.newFixedThreadPool(2)){var publishing=workers.submit(()->commits.commit(lease));assertThat(reached.await(4,TimeUnit.SECONDS)).isTrue();var mutation=workers.submit(()->mutate(kind));try{await(()->db.queryForObject("SELECT count(*) FROM pg_stat_activity WHERE ?=ANY(pg_blocking_pids(pid))",Integer.class,pid.get())==1);}finally{release.countDown();}assertThat(publishing.get(5,TimeUnit.SECONDS).messageIds()).hasSize(2);mutation.get(5,TimeUnit.SECONDS);}
        assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_message WHERE session_id=20 AND usage=1",Integer.class)).isEqualTo(3);
    }
    @ParameterizedTest @ValueSource(strings={"recall","remove"}) void lifecycleWriterWinningFirstPreventsPublication(String kind){var lease=ready();mutate(kind);assertThatThrownBy(()->commits.commit(lease)).hasMessage("RESOURCE_NOT_ACCESSIBLE");assertThat(rows.target(1L,lease.targetId()).getState()).isEqualTo("READY");}
    @Test void groupLockWaitCannotExtendExpiredLease()throws Exception{
        var lease=ready();try(Connection blocker=ds.getConnection();var workers=Executors.newSingleThreadExecutor()){blocker.setAutoCommit(false);try(var statement=blocker.createStatement()){statement.execute("SELECT session_id FROM byai.byai_session WHERE session_id=10 FOR UPDATE");}
            db.update("UPDATE byai.byai_group_chat_forward_target SET lease_until=clock_timestamp()+interval '300 milliseconds' WHERE target_id=?",lease.targetId());var pending=workers.submit(()->commits.commit(lease));
            await(()->db.queryForObject("SELECT lease_until<clock_timestamp() FROM byai.byai_group_chat_forward_target WHERE target_id=?",Boolean.class,lease.targetId()));blocker.rollback();assertThatThrownBy(()->pending.get(5,TimeUnit.SECONDS)).hasRootCauseMessage("FORWARD_LEASE_LOST");}
        assertThat(rows.target(1L,lease.targetId()).getMessageIdsJson()).isEqualTo("[]");
    }
    @Test void newClaimFencesPreviousReadyPublisher(){var old=ready();db.update("UPDATE byai.byai_group_chat_forward_target SET lease_until=clock_timestamp()-interval '1 second' WHERE target_id=?",old.targetId());var next=store.claimTarget(new ForwardOperationLocator(1,old.requestId(),ForwardBackend.LEGACY),old.targetId(),"replacement",Duration.ofMinutes(1));assertThat(next.fencingVersion()).isGreaterThan(old.fencingVersion());assertThatThrownBy(()->commits.commit(old)).hasMessage("FORWARD_LEASE_LOST");assertThat(commits.commit(next).messageIds()).hasSize(2);}
    @Test void secondDatabaseWriteRollsBackTheWholeTarget(){var lease=ready();db.execute("ALTER TABLE byai.byai_message ADD CONSTRAINT fixture_second_failure CHECK(session_id<>20 OR message_content<>'second')");assertThatThrownBy(()->commits.commit(lease)).isInstanceOf(RuntimeException.class);assertThat(rows.items(1L,lease.targetId())).allMatch(i->i.getBoundMessageId()==null);assertThat(rows.target(1L,lease.targetId()).getPendingDelivery()).isFalse();assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_message WHERE session_id=20",Integer.class)).isEqualTo(1);}
}
