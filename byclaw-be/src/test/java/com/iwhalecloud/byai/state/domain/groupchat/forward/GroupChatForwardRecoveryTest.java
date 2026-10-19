package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.node.ObjectNode;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance;
import java.time.Instant;
import java.util.List;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class GroupChatForwardRecoveryTest {
    private org.springframework.context.MessageSource originalMessages;
    @org.junit.jupiter.api.BeforeEach void initializeMessages() {
        originalMessages=(org.springframework.context.MessageSource)org.springframework.test.util.ReflectionTestUtils.getField(com.iwhalecloud.byai.common.i18n.I18nUtil.class,"messageSource");
        var messages=new org.springframework.context.support.StaticMessageSource();messages.setUseCodeAsDefaultMessage(true);
        org.springframework.test.util.ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class,"messageSource",messages);
    }
    @org.junit.jupiter.api.AfterEach void restoreMessages() {
        org.springframework.test.util.ReflectionTestUtils.setField(com.iwhalecloud.byai.common.i18n.I18nUtil.class,"messageSource",originalMessages);
    }
    private final ObjectMapper json = new ObjectMapper();
    @Test void partialDeliveredBatchResumesWithoutRecreate() {
        ObjectNode checkpoint = json.createObjectNode();
        checkpoint.putObject("unrelated").put("retained", true);
        ForwardMaintenance.delivered(checkpoint, "901", "ENQUEUED", Instant.EPOCH);
        assertThat(ForwardMaintenance.pending(checkpoint, List.of("901", "902"))).containsExactly("902");
        assertThat(checkpoint.path("unrelated").path("retained").asBoolean()).isTrue();
        ForwardMaintenance.delivered(checkpoint, "902", "SUPPRESSED", Instant.EPOCH);
        assertThat(ForwardMaintenance.pending(checkpoint, List.of("901", "902"))).isEmpty();
    }
    @Test void corruptJournalFailsClosed() throws Exception {
        ObjectNode checkpoint = (ObjectNode) json.readTree("{\"maintenance\":{\"schemaVersion\":99}}");
        assertThatThrownBy(() -> ForwardMaintenance.pending(checkpoint,List.of("901")))
            .hasMessage("FORWARD_MAINTENANCE_INVALID");
    }
    private GroupChatForwardServiceTest fixture;
    private com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyForwardMaintenanceStore maintenanceStore;
    private com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator locator;
    private long target;
    private void owningFixture() throws Exception {
        fixture=new GroupChatForwardServiceTest();fixture.setup();
        var op=fixture.store.prepare(fixture.actor,10,fixture.input("recovery"));target=fixture.rows.targets(1L,op.requestId()).getFirst().getTargetId();
        locator=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator(1,op.requestId(),com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardBackend.LEGACY);
        var sessions=(com.iwhalecloud.byai.state.domain.session.service.SessionService)org.springframework.test.util.ReflectionTestUtils.getField(fixture.store,"sessions");
        var members=(com.iwhalecloud.byai.state.domain.session.service.SessionMemberService)org.springframework.test.util.ReflectionTestUtils.getField(fixture.store,"members");
        var messages=org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper.class);
        org.mockito.Mockito.when(messages.selectByMessageId(org.mockito.ArgumentMatchers.anyLong())).thenAnswer(inv->{
            long id=inv.getArgument(0);var rows=fixture.db.queryForList("SELECT * FROM byai.byai_message WHERE message_id=?",id);if(rows.isEmpty())return null;
            var row=rows.getFirst();var m=new com.iwhalecloud.byai.common.message.entity.ByaiMessage();m.setMessageId(id);m.setSessionId(((Number)row.get("SESSION_ID")).longValue());m.setEnterpriseId(1L);m.setUsage(1);m.setCreatorId(30L);m.setCreatorName("sender");m.setMessageContent((String)row.get("MESSAGE_CONTENT"));m.setMetadata("{\"scene\":\"GROUP_CHAT\",\"kind\":\"FORWARD_SINGLE\"}");m.setRecalledAt((java.util.Date)row.get("RECALLED_AT"));m.setRecalledBy(31L);m.setArchivedAt((java.util.Date)row.get("ARCHIVED_AT"));return m;
        });
        fixture.db.execute("ALTER TABLE byai.byai_message ADD recalled_at TIMESTAMP");fixture.db.execute("ALTER TABLE byai.byai_message ADD archived_at TIMESTAMP");
        var member=new com.iwhalecloud.byai.manager.entity.session.ByaiSessionMember();member.setMemObjId(31L);
        org.mockito.Mockito.when(members.findSessionMembers(20L,"USER",null)).thenReturn(List.of(member));
        var projector=new com.iwhalecloud.byai.state.domain.chat.service.GroupChatContextService(messages,sessions,null);
        maintenanceStore=new com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyForwardMaintenanceStore(fixture.db,fixture.rows,new ObjectMapper().findAndRegisterModules(),new org.springframework.jdbc.datasource.DataSourceTransactionManager(fixture.db.getDataSource()),sessions,members,messages,projector,fixture.store);
    }
    private void succeeded() {
        fixture.db.update("UPDATE byai.byai_group_chat_forward_target SET state='SUCCEEDED',pending_delivery=TRUE,message_ids_json='[\"901\",\"902\"]' WHERE target_id=?",target);
        var items=fixture.rows.items(1L,target);for(int i=0;i<items.size();i++)fixture.db.update("UPDATE byai.byai_group_chat_forward_item SET bound_message_id=? WHERE item_id=?",901+i,items.get(i).getItemId());
        fixture.db.execute("INSERT INTO byai.byai_message(message_id,enterprise_id,session_id,message_content) VALUES(901,1,20,'originalBody'),(902,1,20,'originalBody')");
    }
    @Test void actorLeftButCurrentRecipientsStillReceiveSafeProjection() throws Exception {
        owningFixture();succeeded();fixture.db.execute("DELETE FROM byai.byai_session_member WHERE mem_obj_id=30");
        var lease=maintenanceStore.claimDelivery(locator,target,"delivery",java.time.Duration.ofSeconds(60));
        var delivery=maintenanceStore.delivery(lease,901);assertThat(delivery.userRecipientIds()).containsExactly(31L);assertThat(delivery.messages().getFirst().get("canAcknowledge")).isEqualTo(false);
        lease=maintenanceStore.markDelivered(lease,901,ForwardMaintenance.Outcome.ENQUEUED);
        fixture.db.update("UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP WHERE message_id=902");
        assertThat(maintenanceStore.delivery(lease,902).toString()).doesNotContain("originalBody");
        fixture.db.update("UPDATE byai.byai_message SET archived_at=CURRENT_TIMESTAMP WHERE message_id=902");assertThat(maintenanceStore.delivery(lease,902)).isNull();
        maintenanceStore.markDelivered(lease,902,ForwardMaintenance.Outcome.SUPPRESSED);
        assertThat(fixture.rows.target(1L,target).getPendingDelivery()).isFalse();
    }
    @Test void durableMessageJournalRejectsStaleVersionAndResumesRemainingMessage() throws Exception {
        owningFixture();succeeded();var first=maintenanceStore.claimDelivery(locator,target,"old",java.time.Duration.ofSeconds(60));maintenanceStore.markDelivered(first,901,ForwardMaintenance.Outcome.ENQUEUED);
        assertThatThrownBy(()->maintenanceStore.markDelivered(first,902,ForwardMaintenance.Outcome.ENQUEUED)).hasMessage("FORWARD_LEASE_LOST");
        fixture.db.update("UPDATE byai.byai_group_chat_forward_target SET lease_until=TIMESTAMP '2000-01-01 00:00:00' WHERE target_id=?",target);
        var resumed=maintenanceStore.claimDelivery(locator,target,"new",java.time.Duration.ofSeconds(60));assertThat(resumed.pendingMessageIds()).containsExactly("902");
        assertThat(fixture.db.queryForObject("SELECT count(*) FROM byai.byai_message WHERE session_id=20",Integer.class)).isEqualTo(2);
    }
    @Test void leaseCancellationClosesBlockedSourceWithoutSleep() throws Exception {
        var entered=new java.util.concurrent.CountDownLatch(1);var closed=new java.util.concurrent.CountDownLatch(1);
        var cancellation=new com.iwhalecloud.byai.state.domain.groupchat.forward.attachment.ForwardStreamCancellation();
        var input=new java.io.InputStream(){public int read()throws java.io.IOException{entered.countDown();try{closed.await();}catch(InterruptedException e){Thread.currentThread().interrupt();}throw new java.io.IOException("closed");}public void close(){closed.countDown();}};
        cancellation.track(input);try(var executor=java.util.concurrent.Executors.newSingleThreadExecutor()){var reading=executor.submit(()->assertThatThrownBy(input::read).isInstanceOf(java.io.IOException.class));assertThat(entered.await(2,java.util.concurrent.TimeUnit.SECONDS)).isTrue();cancellation.close();reading.get(2,java.util.concurrent.TimeUnit.SECONDS);}
        assertThatThrownBy(cancellation::check).hasMessage("FORWARD_LEASE_LOST");
    }

    @Test void recoveryReadsAgainAfterUnknownEnqueueOutcome() throws Exception {
        owningFixture();succeeded();
        var contexts=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardExecutionContextService.class);
        var publisher=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardDeliveryPublisher.class);
        org.mockito.Mockito.doThrow(new IllegalStateException("FORWARD_DELIVERY_UNAVAILABLE")).doNothing().when(publisher).publish(org.mockito.ArgumentMatchers.any());
        var recovery=new com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardRecoveryService(null,maintenanceStore,null,contexts,null,publisher,new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties());
        var candidate=new ForwardMaintenance.Candidate(locator,target,true);
        try {
            assertThatThrownBy(()->recovery.process(maintenanceStore,candidate,ForwardMaintenance.Category.DELIVERY)).hasMessage("FORWARD_DELIVERY_UNAVAILABLE");
            assertThat(fixture.rows.target(1L,target).getPendingDelivery()).isTrue();
            fixture.db.update("UPDATE byai.byai_group_chat_forward_target SET lease_until=TIMESTAMP '2000-01-01 00:00:00' WHERE target_id=?",target);
            fixture.db.update("UPDATE byai.byai_message SET recalled_at=CURRENT_TIMESTAMP WHERE session_id=20");
            recovery.process(maintenanceStore,candidate,ForwardMaintenance.Category.DELIVERY);
            var captured=org.mockito.ArgumentCaptor.forClass(ForwardMaintenance.Delivery.class);org.mockito.Mockito.verify(publisher,org.mockito.Mockito.times(3)).publish(captured.capture());
            assertThat(captured.getAllValues().subList(1,3)).allSatisfy(event->assertThat(event.toString()).doesNotContain("originalBody"));
            assertThat(fixture.rows.target(1L,target).getPendingDelivery()).isFalse();
        } finally { recovery.close(); }
    }
    @Test void failuresPersistOnlyUnderLastAcknowledgedFence() throws Exception {
        owningFixture();var request=fixture.store.claimRequest(locator,"source",java.time.Duration.ofSeconds(60));fixture.store.failRequest(request,"FORWARD_SOURCE_UNAVAILABLE",true);
        assertThat(fixture.rows.request(1L,locator.requestId()).getState()).isEqualTo("FAILED");assertThat(fixture.rows.targets(1L,locator.requestId())).allSatisfy(t->{assertThat(t.getRetryable()).isTrue();assertThat(t.getErrorCode()).isEqualTo("FORWARD_SOURCE_UNAVAILABLE");});
        assertThatThrownBy(()->fixture.store.failRequest(request,"FORWARD_SOURCE_CHANGED",false)).hasMessage("FORWARD_LEASE_LOST");
        fixture.store.retry(fixture.actor,10,locator.requestId(),java.util.Set.of(20L,21L));
        fixture.store.freezeSources(fixture.store.claimRequest(locator,"next",java.time.Duration.ofSeconds(60)),new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.FreezeCompletion(List.of(),List.of()));
        var lease=fixture.store.claimTarget(locator,target,"copy",java.time.Duration.ofSeconds(60));fixture.store.failTarget(lease,"FORWARD_ADMISSION_BUSY",true);
        assertThat(fixture.rows.target(1L,target).getState()).isEqualTo("FAILED");assertThat(fixture.rows.request(1L,locator.requestId()).getState()).isEqualTo("RUNNING");
        assertThatThrownBy(()->fixture.store.failTarget(lease,"FORWARD_SOURCE_CHANGED",false)).hasMessage("FORWARD_LEASE_LOST");
    }

    @Test void sustainedLegacyAndEarlyTenantBacklogsCannotStarveLaterDatabases() {
        var directory=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.ForwardRecoveryDirectory.class);
        var legacy=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.LegacyForwardMaintenanceStore.class);
        var tenant=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.infrastructure.TenantForwardMaintenanceStore.class);
        org.mockito.Mockito.when(directory.legacyEnterprises(org.mockito.ArgumentMatchers.anyLong(),org.mockito.ArgumentMatchers.eq(1)))
            .thenAnswer(invocation->(long)invocation.getArgument(0)==0?List.of(1L):List.of());
        org.mockito.Mockito.when(directory.readyTenants(org.mockito.ArgumentMatchers.anyLong(),org.mockito.ArgumentMatchers.eq(4)))
            .thenAnswer(invocation->(long)invocation.getArgument(0)==0?List.of(10L,20L,30L,40L):List.of());
        org.mockito.stubbing.Answer<ForwardMaintenance.Page> backlog=invocation->{
            long enterprise=invocation.getArgument(0);String after=invocation.getArgument(2);int limit=invocation.getArgument(3);
            assertThat(limit).isBetween(1,20);long start=after==null?1:Long.parseLong(after)+1;
            var backend=invocation.getMock()==legacy?com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardBackend.LEGACY:com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardBackend.TENANT;
            var binding=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator(enterprise,100,backend);
            var candidates=java.util.stream.LongStream.range(start,start+limit).mapToObj(id->new ForwardMaintenance.Candidate(binding,id,true)).toList();
            return new ForwardMaintenance.Page(candidates,Long.toString(start+limit-1));
        };
        org.mockito.Mockito.when(legacy.scan(org.mockito.ArgumentMatchers.anyLong(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyInt())).thenAnswer(backlog);
        org.mockito.Mockito.when(tenant.scan(org.mockito.ArgumentMatchers.anyLong(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.anyInt())).thenAnswer(backlog);
        var executor=org.mockito.Mockito.mock(java.util.concurrent.ExecutorService.class);
        var queued=new java.util.ArrayDeque<Runnable>();
        org.mockito.Mockito.doAnswer(invocation->{queued.add(invocation.getArgument(0));return null;}).when(executor).execute(org.mockito.ArgumentMatchers.any());
        var contexts=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardExecutionContextService.class);
        var owning=org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.groupchat.forward.port.GroupChatForwardStore.class);
        org.mockito.Mockito.when(contexts.store(org.mockito.ArgumentMatchers.any())).thenReturn(owning);
        org.mockito.Mockito.when(owning.discoverRequestWork(org.mockito.ArgumentMatchers.any())).thenAnswer(invocation->{
            var locator=(com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator)invocation.getArgument(0);
            return new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.WorkPage(List.of(new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.WorkCandidate(locator,1,true)),null,false);
        });
        var discovery=org.mockito.Mockito.mock(java.util.concurrent.ExecutorService.class);
        org.mockito.Mockito.doAnswer(invocation->{((Runnable)invocation.getArgument(0)).run();return null;}).when(discovery).execute(org.mockito.ArgumentMatchers.any());
        var recovery=org.mockito.Mockito.spy(new com.iwhalecloud.byai.state.domain.groupchat.forward.application.GroupChatForwardRecoveryService(directory,legacy,tenant,contexts,null,null,new com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties()));
        org.springframework.test.util.ReflectionTestUtils.setField(recovery,"workers",executor);
        org.springframework.test.util.ReflectionTestUtils.setField(recovery,"tenantWorkers",executor);
        org.springframework.test.util.ReflectionTestUtils.setField(recovery,"tenantDiscovery",discovery);
        var admitted=new java.util.LinkedHashSet<String>();
        org.mockito.Mockito.doAnswer(invocation->{ForwardMaintenance.Candidate candidate=invocation.getArgument(1);admitted.add(candidate.locator().backend()+":"+candidate.locator().enterpriseId());return null;})
            .when(recovery).process(org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any(),org.mockito.ArgumentMatchers.any());
        try {
            for(int pass=0;pass<12;pass++) {
                recovery.recover(Instant.EPOCH,20);assertThat(queued.size()).isLessThanOrEqualTo(6);
                while(!queued.isEmpty())queued.removeFirst().run();
            }
            assertThat(admitted).contains("LEGACY:1","TENANT:10","TENANT:20","TENANT:30","TENANT:40");
        } finally {recovery.close();}
    }

}
