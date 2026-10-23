package com.iwhalecloud.byai.state.domain.groupchat.forward;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.*;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.entity.session.*;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyGroupChatForwardStore;
import com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.source.LegacyForwardSourceAuthorityReader;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.mapping.Environment;
import org.apache.ibatis.session.SqlSessionFactoryBuilder;
import org.mybatis.spring.SqlSessionTemplate;
import org.mybatis.spring.transaction.SpringManagedTransactionFactory;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.core.JdbcTemplate;
import org.junit.jupiter.api.*;
import java.nio.file.*;
import java.time.Duration;
import java.util.*;
import java.util.concurrent.atomic.AtomicLong;

/** Real preparation SQL/MyBatis/Spring transactions, with owning domain reads backed by the same fixture connection. */
class GroupChatForwardServiceTest {
    @Test
    void laterAuthorizationRejectionPreservesEarlierClaim() {
        var legacy = mock(LegacyGroupChatForwardStore.class);
        var contexts = mock(com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardExecutionContextService.class);
        var first = new ForwardOperationLocator(1, 100, ForwardBackend.LEGACY);
        var denied = new ForwardOperationLocator(1, 101, ForwardBackend.LEGACY);
        var unready = new ForwardOperationLocator(1, 102, ForwardBackend.LEGACY);
        var lease = new TargetLease(100, 200, actor, 10, 20, "owner", 1,
            java.time.Instant.now().plusSeconds(60), ForwardState.COPYING);
        when(legacy.discoverWork(1, null, 20)).thenReturn(new WorkPage(List.of(
            new WorkCandidate(first, 200, true), new WorkCandidate(denied, 201, true),
            new WorkCandidate(unready, 202, true)), "202", true));
        when(legacy.claimTarget(eq(first), eq(200L), anyString(), any())).thenReturn(lease);
        when(contexts.resume(denied, ForwardPhase.COPY)).thenThrow(new IllegalArgumentException("RESOURCE_NOT_ACCESSIBLE"));
        when(contexts.resume(unready, ForwardPhase.COPY)).thenThrow(new IllegalArgumentException("FORWARD_TENANT_NOT_READY"));
        var service = new com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardService(
            legacy, null, contexts, null, null, null, null, null, new GroupChatForwardProperties());

        var result = service.claimWork(ForwardBackend.LEGACY, 1, null, 20, Duration.ofMinutes(1));

        assertThat(result.leases()).containsExactly(lease);
        assertThat(result.nextCursor()).isEqualTo("202");
        assertThat(result.hasMore()).isTrue();
        verify(legacy, never()).claimTarget(eq(denied), anyLong(), anyString(), any());
        verify(legacy, never()).claimTarget(eq(unready), anyLong(), anyString(), any());
    }

    JdbcTemplate db;LegacyGroupChatForwardStore store;ByaiGroupChatForwardMapper rows;
    ForwardActor actor=new ForwardActor(30,1);
    ForwardInput input(String key){return new ForwardInput(key,ForwardMode.SINGLE,List.of(101L,102L),List.of(20L,21L));}
    @BeforeEach void setup()throws Exception{
        var ds=new DriverManagerDataSource("jdbc:h2:mem:prepare"+System.nanoTime()+";MODE=PostgreSQL;DB_CLOSE_DELAY=-1","sa","");db=new JdbcTemplate(ds);
        db.execute("CREATE SCHEMA byai");db.execute("CREATE ALIAS clock_timestamp FOR \"com.iwhalecloud.byai.state.domain.groupchat.forward.GroupChatForwardStoreTest.clockTimestamp\"");
        db.execute("CREATE TABLE byai.byai_session(session_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_type VARCHAR,state VARCHAR)");db.execute("CREATE TABLE byai.byai_session_member(byai_session_member_id BIGINT,session_id BIGINT,mem_obj_type VARCHAR,mem_obj_id BIGINT,com_acct_id BIGINT)");db.execute("CREATE TABLE byai.byai_message(message_id BIGINT PRIMARY KEY,enterprise_id BIGINT,session_id BIGINT,message_content VARCHAR,create_time TIMESTAMP)");
        db.execute(Files.readString(Path.of("../deploy/migrations/versions/V0.6.0/V0.6.0__ddl.sql")).replace("SET search_path TO byai;","SET SCHEMA byai;"));
        db.update("INSERT INTO byai.byai_session VALUES(10,1,'hs_as','ACTIVE'),(20,1,'hs_as','ACTIVE'),(21,1,'hs_as','ACTIVE'),(22,2,'hs_as','ACTIVE')");db.update("INSERT INTO byai.byai_session_member(byai_session_member_id,session_id,mem_obj_type,mem_obj_id,com_acct_id) VALUES(1,10,'USER',30,NULL),(2,20,'USER',30,99),(3,21,'USER',30,1)");db.update("INSERT INTO byai.byai_message VALUES(101,1,10,'later',TIMESTAMP '2026-10-16 01:00:00'),(102,1,10,'earlier',TIMESTAMP '2026-10-16 00:00:00')");
        var configuration=new MybatisConfiguration();configuration.setMapUnderscoreToCamelCase(true);configuration.setLocalCacheScope(org.apache.ibatis.session.LocalCacheScope.STATEMENT);configuration.setEnvironment(new Environment("test",new SpringManagedTransactionFactory(),ds));configuration.addMapper(ByaiGroupChatForwardMapper.class);rows=spy(new SqlSessionTemplate(new SqlSessionFactoryBuilder().build(configuration)).getMapper(ByaiGroupChatForwardMapper.class));
        var sessions=mock(SessionService.class);when(sessions.findById(anyLong())).thenAnswer(inv->{var found=db.query("SELECT * FROM byai.byai_session WHERE session_id=?",(rs,i)->{var s=new ByaiSession();s.setSessionId(rs.getLong("session_id"));s.setEnterpriseId(rs.getLong("enterprise_id"));s.setSessionType(rs.getString("session_type"));s.setState(rs.getString("state"));return s;},(Object)inv.getArgument(0));return found.isEmpty()?null:found.getFirst();});
        var members=mock(SessionMemberService.class);when(members.findSessionMember(anyLong(),eq("USER"),eq(30L))).thenAnswer(inv->{var found=db.query("SELECT * FROM byai.byai_session_member WHERE session_id=? AND mem_obj_id=30",(rs,i)->{var m=new ByaiSessionMember();m.setComAcctId((Long)rs.getObject("com_acct_id"));return m;},(Object)inv.getArgument(0));return found.isEmpty()?null:found.getFirst();});
        var messages=mock(ByaiMessageMapper.class);when(messages.selectByMessageId(anyLong())).thenAnswer(inv->{var found=db.query("SELECT * FROM byai.byai_message WHERE message_id=?",(rs,i)->{var m=new ByaiMessage();m.setMessageId(rs.getLong("message_id"));m.setEnterpriseId(rs.getLong("enterprise_id"));m.setSessionId(rs.getLong("session_id"));m.setUsage(1);m.setCreatorId(30L);m.setCreatorName("sender");m.setMessageContent(rs.getString("message_content"));m.setCreateTime(rs.getTimestamp("create_time"));return m;},(Object)inv.getArgument(0));return found.isEmpty()?null:found.getFirst();});
        var source=new LegacyForwardSourceAuthorityReader(sessions,members,messages,mock(ByaiGroupChatTaskMapper.class),mock(ByaiGroupChatTaskPublicationMapper.class),mock(ByaiGroupChatPendingPublicationMapper.class),mock(ByaiGroupChatForwardSourceMapper.class),rows);
        var sequence=mock(SequenceService.class);var next=new AtomicLong(1000);when(sequence.nextVal()).thenAnswer(i->next.incrementAndGet());var props=new GroupChatForwardProperties();store=new LegacyGroupChatForwardStore(rows,db,new DataSourceTransactionManager(ds),new ObjectMapper().findAndRegisterModules(),sequence,sessions,members,source,mock(ForwardPlatformPolicy.class),new ForwardUploadReservation(props),props);
    }
    @Test void prepareRollsBackAllRowsOnSnapshotFailure(){db.update("UPDATE byai.byai_message SET message_content='{{COMMON_FILE_missing}}' WHERE message_id=101");assertThatThrownBy(()->store.prepare(actor,10,input("key"))).hasMessage("FORWARD_RESOURCE_UNRESOLVABLE");assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_group_chat_forward_request",Integer.class)).isZero();}
    @Test void sameRequestReplaysIdsAfterLeavingSource(){var operation=store.prepare(actor,10,input("key"));var target=rows.targets(1L,operation.requestId()).getFirst();db.update("UPDATE byai.byai_group_chat_forward_target SET state='SUCCEEDED',message_ids_json='[\"500\"]' WHERE target_id=?",target.getTargetId());db.update("DELETE FROM byai.byai_session_member WHERE session_id=10");assertThat(store.prepare(actor,10,input("key")).targets().getFirst().messageIds()).containsExactly("500");assertThat(store.status(actor,10,operation.requestId()).toString()).doesNotContain("earlier");}
    @Test void sameKeyChangedHashConflicts(){store.prepare(actor,10,input("key"));assertThatThrownBy(()->store.prepare(actor,10,new ForwardInput("key",ForwardMode.MERGED,List.of(101L,102L),List.of(20L,21L)))).hasMessage("IDEMPOTENCY_CONFLICT");}
    @Test void insertConflictReplaysExistingRequestWithoutDuplicatingRows(){
        var original=store.prepare(actor,10,input("key"));
        var existing=rows.requestByKey(1L,30L,"key");
        // 模拟首次查询未命中、插入时同一幂等键已被其他请求占用。
        doReturn(null,existing).when(rows).requestByKey(1L,30L,"key");

        var replayed=store.prepare(actor,10,input("key"));

        assertThat(replayed.requestId()).isEqualTo(original.requestId());
        assertThat(replayed.targets()).isEqualTo(original.targets());
        assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_group_chat_forward_request",Integer.class)).isEqualTo(1);
        assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_group_chat_forward_target",Integer.class)).isEqualTo(2);
        assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_group_chat_forward_item",Integer.class)).isEqualTo(4);
    }
    @Test void insertConflictStillRejectsChangedRequestContent(){
        store.prepare(actor,10,input("key"));
        var existing=rows.requestByKey(1L,30L,"key");
        doReturn(null,existing).when(rows).requestByKey(1L,30L,"key");

        assertThatThrownBy(()->store.prepare(actor,10,new ForwardInput("key",ForwardMode.MERGED,List.of(101L,102L),List.of(20L,21L))))
            .hasMessage("IDEMPOTENCY_CONFLICT");
        assertThat(db.queryForObject("SELECT count(*) FROM byai.byai_group_chat_forward_request",Integer.class)).isEqualTo(1);
    }
    @Test void legacyHistoricalMemberFieldsStayCompatibleAndTimelineIsNotNumericIdOrder(){var result=store.prepare(actor,10,input("key"));for(var target:rows.targets(1L,result.requestId())){assertThat(rows.items(1L,target.getTargetId()).stream().map(i->i.getSourceMessageId()).toList()).containsExactly(102L,101L);}assertThat(result.targets()).allMatch(t->t.state()==ForwardState.PENDING);}
    @Test void deniedTargetsProduceIndependentFailures(){var result=store.prepare(actor,10,new ForwardInput("key",ForwardMode.SINGLE,List.of(101L),List.of(20L,22L,999L)));assertThat(result.targets().stream().map(ForwardTarget::state).toList()).containsExactly(ForwardState.PENDING,ForwardState.FAILED,ForwardState.FAILED);assertThat(result.targets().get(1).errorCode()).isEqualTo(result.targets().get(2).errorCode());}
    @Test void immediateWorkDiscoveryOnlyReadsTheSubmittedRequest(){
        var first=store.prepare(actor,10,input("first"));
        store.prepare(actor,10,input("second"));
        var page=store.discoverRequestWork(new ForwardOperationLocator(1,first.requestId(),ForwardBackend.LEGACY));
        assertThat(page.candidates()).hasSize(2).allSatisfy(candidate->assertThat(candidate.locator().requestId()).isEqualTo(first.requestId()));
    }
    @Test void sourceProofOnlyFreezesOnceAndReadyRequiresNoFileIOForEmptyFiles(){var result=store.prepare(actor,10,input("key"));var locator=new ForwardOperationLocator(1,result.requestId(),ForwardBackend.LEGACY);var request=store.claimRequest(locator,"resolver",Duration.ofMinutes(1));store.freezeSources(request,new FreezeCompletion(List.of(),List.of()));assertThatThrownBy(()->store.freezeSources(request,new FreezeCompletion(List.of(),List.of()))).hasMessage("FORWARD_LEASE_LOST");var targets=rows.targets(1L,result.requestId());var lease=store.claimTarget(locator,targets.getFirst().getTargetId(),"worker",Duration.ofMinutes(1));assertThatThrownBy(()->store.claimTarget(locator,targets.getLast().getTargetId(),"other",Duration.ofMinutes(1))).hasMessage("FORWARD_LEASE_LOST");var ready=store.markReady(lease);assertThat(ready.state()).isEqualTo(ForwardState.READY);assertThat(ready.fencingVersion()).isEqualTo(lease.fencingVersion()+1);}
}
