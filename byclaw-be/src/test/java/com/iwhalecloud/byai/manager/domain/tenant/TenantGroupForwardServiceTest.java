package com.iwhalecloud.byai.manager.domain.tenant;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.application.ForwardPlatformPolicy;
import com.iwhalecloud.byai.state.domain.groupchat.forward.config.GroupChatForwardProperties;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.storage.ForwardUploadedFile;
import org.junit.jupiter.api.Test;
import java.time.*;
import java.util.*;
class TenantGroupForwardServiceTest {
    @Test void requestLeaseUsesPersistedActorAndNumericDurationWithoutThreadContext()throws Exception{
        var node=mock(TenantNodeClient.class);var policy=mock(ForwardPlatformPolicy.class);var actor=new ForwardActor(9007199254740993L,10);var locator=new ForwardOperationLocator(10,9007199254740994L,ForwardBackend.TENANT);var binding=new OperationBinding(locator,actor,30);var context=new TenantRequestContext(actor.userId(),10,"MEMBER");when(node.serviceRequest(eq(10L),eq("GET"),contains("/binding"),isNull(),any())).thenReturn(binding);when(policy.requireNewWork(actor,ForwardBackend.TENANT)).thenReturn(context);
        when(node.request(eq(context),eq("POST"),contains("/lease"),any(),any())).thenAnswer(inv->{var wire=TenantNodeClient.protocolMapper(new ObjectMapper().findAndRegisterModules()).valueToTree(inv.getArgument(3));assertThat(wire.path("durationMs").isNumber()).isTrue();assertThat(wire.path("durationMs").asLong()).isEqualTo(60000);assertThat(wire.has("actor")).isFalse();return new RequestLease(locator.requestId(),actor,"claim",9007199254740995L,Instant.now().plusSeconds(60));});
        var service=new TenantGroupForwardService(node,policy,new GroupChatForwardProperties());var result=service.claimRequest(locator,"claim",Duration.ofMinutes(1));assertThat(result.actor()).isEqualTo(actor);verify(policy).requireNewWork(actor,ForwardBackend.TENANT);
    }
    @Test void proofAndUploadBytesRemainNumbersWhileIdsAndFencesRemainStrings()throws Exception{
        var wire=TenantNodeClient.protocolMapper(new ObjectMapper().findAndRegisterModules());var proof=new SourceProof("proof",new SourceIdentity(10,9007199254740993L,"minio","owner","file",null),2147483648L,"a".repeat(64));var p=wire.valueToTree(proof);assertThat(p.path("size").isNumber()).isTrue();assertThat(p.path("identity").path("ownerId").asText()).isEqualTo("9007199254740993");var object=new ForwardUploadedFile(10, 30, 9007199254740994L, "item", "attachment", "attempt", "file", null, 3, proof.sha256(), Instant.now());assertThat(wire.valueToTree(object).path("size").isNumber()).isTrue();assertThat(wire.valueToTree(object).path("createdAt").isTextual()).isTrue();assertThat(wire.valueToTree(new RequestLease(1,new ForwardActor(2,3),"claim",9007199254740993L,Instant.now())).path("leaseUntil").isTextual()).isTrue();
    }
    @Test void targetReadersUseTypedRawNodeDataWithoutLegacyFallback() {
        var node=mock(TenantNodeClient.class);var policy=mock(ForwardPlatformPolicy.class);var actor=new ForwardActor(30,10);var context=new TenantRequestContext(30,10,"MEMBER");
        when(policy.requireNewWork(actor,ForwardBackend.TENANT)).thenReturn(context);
        var service=new TenantGroupForwardService(node,policy,new GroupChatForwardProperties());
        var page=new com.iwhalecloud.byai.state.domain.groupchat.forward.dto.ForwardDtos.ItemPage(List.of(),20,false,null);
        when(node.request(eq(context),eq("GET"),eq("/internal/v1/group-chats/9007199254740993/messages/9007199254740995/forward-items?pageSize=20"),isNull(),any())).thenReturn(page);
        assertThat(service.items(actor,9007199254740993L,9007199254740995L,20,null)).isSameAs(page);
        when(node.request(eq(context),eq("GET"),eq("/internal/v1/group-chats/9007199254740993/forward-targets?pageNum=1&pageSize=20&keyword=a%25_"),isNull(),any())).thenReturn(new com.iwhalecloud.byai.common.page.PageInfo<>());
        assertThat(service.targets(actor,9007199254740993L,1,20,"a%_")).isNotNull();
    }

    @org.junit.jupiter.api.Test void maintenanceLeaseWireUsesTextDatesAndDecimalFences() {
        var wire=TenantNodeClient.protocolMapper(new ObjectMapper().findAndRegisterModules());
        var locator=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardPreparation.ForwardOperationLocator(1,100,ForwardBackend.TENANT);
        var lease=new com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardMaintenance.DeliveryLease(locator,200,"owner",9007199254740993L,Instant.parse("2026-10-16T00:00:00Z"),java.util.List.of("901"));
        var body=wire.valueToTree(lease);assertThat(body.path("leaseUntil").isTextual()).isTrue();assertThat(body.path("fencingVersion").asText()).isEqualTo("9007199254740993");
    }

}
