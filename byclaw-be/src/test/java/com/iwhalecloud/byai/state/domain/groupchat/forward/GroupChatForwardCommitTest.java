package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatTopicMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatTopicService;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadReservation;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.test.util.ReflectionTestUtils;
import org.junit.jupiter.api.*;
import java.time.Duration;
import java.util.*;

/** Final transaction uses the real mapper/CAS and topic service; JDBC fixture observes durable rollback. */
class GroupChatForwardCommitTest {
    GroupChatForwardServiceTest fixture;
    GroupChatForwardCommitService commits;
    ObjectMapper json = new ObjectMapper().findAndRegisterModules();
    @BeforeEach void setup() throws Exception {
        fixture = new GroupChatForwardServiceTest(); fixture.setup();
        var db = fixture.db;
        db.execute("ALTER TABLE byai.byai_session ADD project_id BIGINT");
        db.execute("ALTER TABLE byai.byai_session_member ADD mem_name VARCHAR DEFAULT 'Forwarder'");
        for (String column : List.of("recalled_at TIMESTAMP", "archived_at TIMESTAMP", "usage INT DEFAULT 1", "topic_id BIGINT", "metadata VARCHAR", "related_resources VARCHAR", "creator_id BIGINT", "creator_name VARCHAR", "message_ref BIGINT")) db.execute("ALTER TABLE byai.byai_message ADD "+column);
        var messages = mock(ByaiMessageMapper.class);
        when(messages.insert(any(ByaiMessage.class))).thenAnswer(inv -> {
            assertThat(org.springframework.transaction.support.TransactionSynchronizationManager.isActualTransactionActive()).as("commit SQL has an active transaction").isTrue();
            ByaiMessage m=inv.getArgument(0);
            return db.update("INSERT INTO byai.byai_message(message_id,enterprise_id,session_id,message_content,create_time,topic_id,metadata,related_resources,creator_id,creator_name,message_ref) VALUES(?,?,?,?,?,?,?,?,?,?,?)",m.getMessageId(),m.getEnterpriseId(),m.getSessionId(),m.getMessageContent(),m.getCreateTime(),m.getTopicId(),m.getMetadata(),m.getRelatedResources(),m.getCreatorId(),m.getCreatorName(),m.getMessageRef());
        });
        var sessions=mock(SessionService.class);
        when(sessions.lockById(anyLong())).thenAnswer(inv->{db.queryForList("SELECT session_id FROM byai.byai_session WHERE session_id=? FOR UPDATE",(Object)inv.getArgument(0));return null;});
        var topics=new GroupChatTopicService(messages,mock(ByaiGroupChatTopicMapper.class),sessions);
        var props=new GroupChatForwardProperties();
        commits=new GroupChatForwardCommitService(fixture.store,fixture.rows,db,new DataSourceTransactionManager(db.getDataSource()),json,
            (SequenceService)ReflectionTestUtils.getField(fixture.store,"ids"),topics,mock(ForwardPlatformPolicy.class),new ForwardUploadReservation(props),props);
    }
    TargetLease ready() {
        var operation=fixture.store.prepare(fixture.actor,10,fixture.input("key"));
        var locator=new ForwardOperationLocator(1,operation.requestId(),ForwardBackend.LEGACY);
        fixture.store.freezeSources(fixture.store.claimRequest(locator,"source",Duration.ofMinutes(1)),new FreezeCompletion(List.of(),List.of()));
        var target=fixture.rows.targets(1L,operation.requestId()).getFirst();
        return fixture.store.markReady(fixture.store.claimTarget(locator,target.getTargetId(),"worker",Duration.ofMinutes(1)));
    }
    @Test void oneTargetCommitsAllOrNone() throws Exception {
        var lease=ready();
        fixture.db.execute("ALTER TABLE byai.byai_message ADD CONSTRAINT fail_second CHECK(session_id=10 OR message_content<>'later')");
        assertThatThrownBy(()->commits.commit(lease)).isInstanceOf(RuntimeException.class);
        assertThat(fixture.db.queryForObject("SELECT count(*) FROM byai.byai_message WHERE session_id=20",Integer.class)).isZero();
        assertThat(fixture.rows.items(1L,lease.targetId())).allMatch(i->i.getBoundMessageId()==null);
        assertThat(fixture.rows.target(1L,lease.targetId()).getPendingDelivery()).isFalse();
        fixture.db.execute("ALTER TABLE byai.byai_message DROP CONSTRAINT fail_second");
        var result=commits.commit(lease); assertThat(result.messageIds()).hasSize(2);
        var messages=fixture.db.queryForList("SELECT * FROM byai.byai_message WHERE session_id=20 ORDER BY message_id");
        assertThat(messages.stream().map(m->m.get("MESSAGE_CONTENT"))).containsExactly("earlier","later");
        assertThat(json.readTree((String)messages.getFirst().get("METADATA")).path("forward").path("forwardId").asText()).isEqualTo(Long.toString(lease.targetId()));
        fixture.db.update("DELETE FROM byai.byai_session_member WHERE session_id=10");
        assertThat(commits.commit(lease)).isEqualTo(result);
    }
    @Test void differentTargetsFailIndependently() {
        var lease=ready(); commits.commit(lease);
        var target=fixture.rows.targets(1L,lease.requestId()).getLast();
        var next=fixture.store.markReady(fixture.store.claimTarget(new ForwardOperationLocator(1,lease.requestId(),ForwardBackend.LEGACY),target.getTargetId(),"next",Duration.ofMinutes(1)));
        fixture.db.update("DELETE FROM byai.byai_session_member WHERE session_id=21");
        assertThatThrownBy(()->commits.commit(next)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        assertThat(fixture.db.queryForObject("SELECT count(*) FROM byai.byai_message WHERE session_id=20",Integer.class)).isEqualTo(2);
    }
    @Test void recallOrRemovalBeforeCommitRejects() {
        var lease=ready(); fixture.db.update("UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP WHERE message_id=101");
        assertThatThrownBy(()->commits.commit(lease)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
        fixture.db.update("UPDATE byai.byai_message SET recalled_at=NULL");
        fixture.db.update("DELETE FROM byai.byai_session_member WHERE session_id=10");
        assertThatThrownBy(()->commits.commit(lease)).hasMessage("RESOURCE_NOT_ACCESSIBLE");
    }
    @Test void expiredWorkerCannotPublish() {
        var lease=ready(); fixture.db.update("UPDATE byai.byai_group_chat_forward_target SET lease_until=TIMESTAMP '2000-01-01' WHERE target_id=?",lease.targetId());
        assertThatThrownBy(()->commits.commit(lease)).hasMessage("FORWARD_LEASE_LOST");
        assertThat(fixture.db.queryForObject("SELECT count(*) FROM byai.byai_message WHERE session_id=20",Integer.class)).isZero();
    }
    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans={false,true})
    void uploadedFilesPublishAsOrdinaryReferencesAndRewriteStoredTokens(boolean knowledge) throws Exception {
        var lease=ready();
        var row=fixture.rows.items(1L,lease.targetId()).getFirst();
        String item=row.getItemId().toString();
        var reservation=new ForwardUploadReservation(new GroupChatForwardProperties()).allocate(1,20,lease.targetId(),item,"slot","a.txt");
        Map<String,Object> file=new HashMap<>();file.put("fileName","a(1).txt");file.put("filePath",knowledge?"/group-forward-files/20/a(1).txt":"/.sessions/20/a(1).txt");file.put("mediaType","text/plain");file.put("size",3L);
        if(knowledge)file.put("cloudResourceId","40");else {file.put("fileId","700");file.put("fileUrl","/commonFile/preview?target-file");}
        var uploaded=new com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile(1, 20, lease.targetId(), item, "slot", reservation.attemptId(), "a.txt", "text/plain", 3, "a".repeat(64), reservation.createdAt(), file);
        var proof=new SourceProof("proof",new SourceIdentity(1,30L,"file","source","/by/source",null),3,"a".repeat(64));
        var binding=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.PreparedAttachment(Long.toString(lease.targetId()),item,"slot","proof",List.of(),List.of("old"));
        var manifest=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.SourceManifest(1,List.of(),List.of(),List.of(proof),List.of(),List.of(binding));
        fixture.db.update("UPDATE byai.byai_group_chat_forward_request SET source_manifest_json=? WHERE request_id=?",json.writeValueAsString(manifest),lease.requestId());
        fixture.db.update("UPDATE byai.byai_group_chat_forward_target SET checkpoint_json=? WHERE target_id=?",json.writeValueAsString(Map.of("attempts",List.of(Map.of("state","VERIFIED","sourceId","proof","object",uploaded)))),lease.targetId());
        fixture.db.update("UPDATE byai.byai_group_chat_forward_item SET content=?,references_json=? WHERE item_id=?","{{old}} file",json.writeValueAsString(List.of(new ForwardReference("old","source","old",knowledge?"KG_DOC_FILE":"COMMON_FILE",null))),row.getItemId());
        commits.commit(lease);
        var persisted=fixture.rows.items(1L,lease.targetId()).stream().filter(v->v.getItemId().equals(row.getItemId())).findFirst().orElseThrow();
        var refs=json.readTree(persisted.getReferencesJson());String id=refs.get(0).path("id").asText();
        assertThat(persisted.getContent()).isEqualTo("{{"+id+"}} file");
        var target=fixture.db.queryForMap("SELECT message_content,metadata,related_resources FROM byai.byai_message WHERE message_id=?",persisted.getBoundMessageId());
        assertThat(target.get("MESSAGE_CONTENT")).isEqualTo(persisted.getContent());
        String jsonFiles=knowledge?(String)target.get("METADATA"):(String)target.get("RELATED_RESOURCES");
        assertThat(json.readTree(jsonFiles).path("files").get(0).path("filePath").asText()).isEqualTo(file.get("filePath"));
        assertThat(jsonFiles).doesNotContain("forward-attachments","attachmentId","targetAttachmentId");
        if(knowledge)assertThat(refs.get(0).path("resourceCode").asText()).contains("40");else assertThat(refs.get(0).path("resourceId").asText()).isEqualTo("/by/.sessions/20/a(1).txt");
    }
}
