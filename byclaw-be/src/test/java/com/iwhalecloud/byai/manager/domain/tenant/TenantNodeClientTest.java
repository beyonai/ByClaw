package com.iwhalecloud.byai.manager.domain.tenant;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.net.URI;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonInclude;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.CommandHashBody;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorEvent;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.MirrorInputPayload;
import com.iwhalecloud.byai.manager.domain.tenant.TenantNodeModels.SessionUpdate;
import com.iwhaleai.byai.framework.core.discovery.ServiceInstance;
import org.junit.jupiter.api.Test;
import org.springframework.web.server.ResponseStatusException;

class TenantNodeClientTest {

    @Test
    void nodeWireKeepsSnowflakeIdsExactInsideMirrorStructuresWhilePagingIsNumeric() throws Exception {
        var delta = new com.iwhalecloud.byai.state.common.dto.AnswerDelta();
        delta.setMessageId(8000000123000000001L);
        delta.setTaskId(8000000123000000002L);
        for (ObjectMapper mapper : List.of(new ObjectMapper(),
            new com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration()
                .jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder()))) {
            ObjectMapper wire = TenantNodeClient.protocolMapper(mapper);
            var structure = wire.readTree(wire.writeValueAsBytes(Map.of("messageStruct", List.of(delta))));
            assertThat(structure.get("messageStruct").get(0).get("messageId").textValue())
                .isEqualTo("8000000123000000001");
            assertThat(structure.get("messageStruct").get(0).get("taskId").textValue())
                .isEqualTo("8000000123000000002");
            var query = wire.readTree(wire.writeValueAsBytes(new TenantNodeModels.MessageQuery("456", 1L, 20L)));
            assertThat(query.get("pageNum").isInt()).isTrue();
            assertThat(query.get("pageSize").intValue()).isEqualTo(20);
        }
    }

    @Test
    void mirrorEventKeepsExplicitNullStreamIdForNodeContract() throws Exception {
        ObjectMapper mapper = new ObjectMapper().setSerializationInclusion(JsonInclude.Include.NON_NULL);
        MirrorEvent event = new MirrorEvent("10", "req-1", "run-1", "trace-1", "20", "21",
            "input-20", null, 0, "0", "INPUT", new MirrorInputPayload("20", "30", null, "你好"));
        assertThat(mapper.readTree(mapper.writeValueAsBytes(event)).has("sourceStreamId")).isTrue();
        assertThat(mapper.readTree(mapper.writeValueAsBytes(event)).get("sourceStreamId").isNull()).isTrue();
    }

    @Test
    void commandHashMatchesNodeCanonicalJsonContract() throws Exception {
        CommandHashBody body = new CommandHashBody(1, "123", "8", "req-1", "456",
            "UPDATE_SESSION", new SessionUpdate("renamed", null));
        assertThat(TenantNodeClient.commandHash(new ObjectMapper(), body))
            .isEqualTo("75ab7e02c951cdd400c61b241ca1744be140c9dd21490dd4c8c2fdbc809e69b1");
    }

    @Test
    void publicApiNumberSerializationCannotChangeNodeCommandProtocol() throws Exception {
        ObjectMapper publicMapper = new com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration()
            .jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder());
        CommandHashBody body = new CommandHashBody(1, "123", "8", "req-1", "456",
            "UPDATE_SESSION", new SessionUpdate("renamed", null));
        assertThat(TenantNodeClient.commandHash(publicMapper, body))
            .isEqualTo("75ab7e02c951cdd400c61b241ca1744be140c9dd21490dd4c8c2fdbc809e69b1");
        ObjectMapper wire = TenantNodeClient.protocolMapper(publicMapper);
        assertThat(wire.readTree(wire.writeValueAsBytes(body)).get("protocolVersion").isInt()).isTrue();
        var ids = new TenantNodeModels.MessageIds(List.of(8000000123000000001L));
        assertThat(wire.readTree(wire.writeValueAsBytes(ids)).get("messageIds").get(0).textValue())
            .isEqualTo("8000000123000000001");
    }

    @Test
    void resolvesRegisteredTenantNodeHttpEndpoint() {
        ServiceInstance instance = instance("123", "1", "987", "READY");
        assertThat(TenantNodeClient.registeredEndpoint("TENANT_DATA_123", 123L, 1L, "987",
            List.of(instance)).toString()).isEqualTo("http://tenant-node.example:3100");
    }

    @Test
    void routesAnIdentityCheckedTenantNodeThroughItsContainerNetwork() {
        URI registered = URI.create("http://host.containers.internal:3100");
        assertThat(TenantNodeClient.containerEndpoint(registered,
            "a8bc9cb9-dd5f-48cc-8bdd-81ab69e20c47"))
            .hasToString("http://sandbox-a8bc9cb9-dd5f-48cc-8bdd-81ab69e20c47:3100");
    }

    @Test
    void rejectsInvalidTenantNodeSandboxIdentity() {
        URI registered = URI.create("http://host.containers.internal:3100");
        assertThatThrownBy(() -> TenantNodeClient.containerEndpoint(registered, "sandbox-other"))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("sandbox identity is invalid");
    }

    @Test
    void rejectsCrossTenantAndStaleRegistrations() {
        assertThatThrownBy(() -> TenantNodeClient.registeredEndpoint("TENANT_DATA_123", 123L, 1L,
            "987", List.of(instance("124", "1", "987", "READY"))))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("registration mismatch");
        assertThatThrownBy(() -> TenantNodeClient.registeredEndpoint("TENANT_DATA_123", 123L, 1L,
            "987", List.of(instance("123", "2", "987", "READY"))))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("registration mismatch");
        assertThatThrownBy(() -> TenantNodeClient.registeredEndpoint("TENANT_DATA_123", 123L, 1L,
            "987", List.of(instance("123", "1", "987", "ADMIN_ONLY"))))
            .isInstanceOf(ResponseStatusException.class).hasMessageContaining("registration mismatch");
    }

    @Test
    void rejectsMissingOrAmbiguousRegistrations() {
        ServiceInstance instance = instance("123", "1", "987", "READY");
        assertThatThrownBy(() -> TenantNodeClient.registeredEndpoint("TENANT_DATA_123", 123L, 1L,
            "987", List.of())).isInstanceOf(ResponseStatusException.class);
        assertThatThrownBy(() -> TenantNodeClient.registeredEndpoint("TENANT_DATA_123", 123L, 1L,
            "987", List.of(instance, instance))).isInstanceOf(ResponseStatusException.class);
    }

    private ServiceInstance instance(String enterpriseId, String generation, String dbRecordId, String mode) {
        ServiceInstance instance = new ServiceInstance();
        instance.setProtocol("http");
        instance.setHost("tenant-node.example");
        instance.setPort(3100);
        instance.setMetadata(Map.of("enterpriseId", enterpriseId, "generation", generation,
            "dbSandboxRecordId", dbRecordId, "mode", mode, "agentType", "TENANT_DATA_123"));
        return instance;
    }
}
