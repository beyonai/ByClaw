package com.iwhalecloud.byai.manager.interfaces.controller.tenant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.integration.security.InternalServicePrincipal;
import com.iwhalecloud.byai.manager.domain.tenant.integration.*;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.Set;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

/** Exercises the actual controller/advice boundary without granting a browser session service authority. */
class TenantInternalControllerTest {
    private MockMvc mvc;
    private TenantCommandStore.Command command;
    private int reads;
    private String runtimeState = "READY";
    private TenantCommandStore.Command deletion;

    private final InternalServicePrincipal principal = new InternalServicePrincipal("client", "HACU", Set.of("tenant:read"), Set.of("42"), false);
    @BeforeEach void setup() {
        command = new TenantCommandStore.Command("10", "HACU", "request-123", "hash", "PROVISION", "42", "PENDING", "RESERVED", null, 1);
        var store = new TenantCommandStore(null) {
            @Override public Command latestProvision(long id) { return command; }
            @Override public Command latestDeletion(long id) { return deletion; }
            @Override public Command find(long id) { return id == 10 ? command : null; }
            @Override public Command byRequest(String source, String request) { return command; }
        };
        var transactions = new org.springframework.jdbc.datasource.DataSourceTransactionManager(
            new org.springframework.jdbc.datasource.DriverManagerDataSource("jdbc:h2:mem:controller", "sa", ""));
        var commands = new TenantCommandService(store, null, null, null, new ObjectMapper(), null, null, transactions, org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.domain.tenant.TenantSandboxProperties.class)) {
            @Override public TenantCommandStore.Command provision(TenantCommandRequest request) { return command; }
            @Override public TenantCommandStore.Command policy(String source, long enterpriseId, com.fasterxml.jackson.databind.JsonNode body) {
                org.junit.jupiter.api.Assertions.assertTrue(body.isObject()); return command;
            }
            @Override public void requireSourceTenant(String source, long enterpriseId) {
                if (!"HACU".equals(source) || enterpriseId != 42) throw new TenantCommandException(403, "SOURCE_TENANT_DENIED");
            }
        };
        var enterprises = new TenantInternalEnterpriseService(null, null, null) {
            @Override public EnterpriseView getEnterprise(long enterpriseId) {
                reads++; return new EnterpriseView(Long.toString(enterpriseId), "Safe enterprise");
            }
        };
        var converters = new java.util.ArrayList<org.springframework.http.converter.HttpMessageConverter<?>>();
        var configuration = new com.iwhalecloud.byai.state.infrastructure.filter.WebMvcConfiguration();
        converters.add(new org.springframework.http.converter.json.MappingJackson2HttpMessageConverter(
            configuration.jacksonObjectMapper(new org.springframework.http.converter.json.Jackson2ObjectMapperBuilder())));
        configuration.extendMessageConverters(converters);
        var tenants = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper.class);
        org.mockito.Mockito.when(tenants.selectConfig(42, "COMMERCIAL_MANAGED")).thenReturn("true");
        org.mockito.Mockito.when(tenants.selectConfig(42, "PROVISION_STATE"))
            .thenAnswer(call -> "{\"status\":\"" + runtimeState + "\"}");
        var policies = org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.domain.tenant.policy.TenantExecutionPolicyService.class);
        var sandboxes = org.mockito.Mockito.mock(com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService.class);
        var controller=new TenantInternalController(commands, store, policies, enterprises, tenants, sandboxes, new ObjectMapper());
        var recovery=org.mockito.Mockito.mock(TenantCommandRecovery.class);
        org.mockito.Mockito.when(recovery.inspect(10)).thenReturn(java.util.Map.of("decision","MANUAL_REQUIRED"));
        org.springframework.test.util.ReflectionTestUtils.setField(controller,"recoveries",recovery);
        mvc = MockMvcBuilders.standaloneSetup(controller, new LegacyConverterProbe())
            .setControllerAdvice(new TenantInternalExceptionHandler())
            .setMessageConverters(converters.toArray(new org.springframework.http.converter.HttpMessageConverter<?>[0])).build();
    }
    @org.springframework.web.bind.annotation.RestController
    static class LegacyConverterProbe {
        @org.springframework.web.bind.annotation.GetMapping("/legacy-converter-contract")
        public com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil<?> result() {
            return com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil.success(java.util.Map.of("count", 1));
        }
    }
    @Test void deletionLifecycleCannotBeOverwrittenByHistoricalProvisionSuccess() throws Exception {
        command = new TenantCommandStore.Command("10", "HACU", "request-123", "hash", "PROVISION", "42", "SUCCEEDED", "READY", null, 3);
        for (String state : new String[]{"DELETING", "DELETE_FAILED", "DELETED"}) {
            runtimeState = state;
            deletion = new TenantCommandStore.Command("11", "HACU", "admin-delete-42", "hash", "DELETE", "42",
                "DELETED".equals(state) ? "SUCCEEDED" : "MANUAL_REQUIRED", "DELETE_RESOURCES", "test-error", 7);
            mvc.perform(get("/internal/v1/tenants/42/runtime").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
                .andExpect(status().isOk()).andExpect(jsonPath("$.data.stage").value(state))
                .andExpect(jsonPath("$.data.status").value(state)).andExpect(jsonPath("$.data.commandId").value("11"))
                .andExpect(jsonPath("$.data.commandRevision").value("7"));
        }
    }

    @Test void legacyConverterRepresentationIsPreserved() throws Exception {
        mvc.perform(get("/legacy-converter-contract")).andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value("0")).andExpect(jsonPath("$.data.count").value("1"));
    }
    @Test void configuredConvertersReadJsonNodeProvisioningAndPolicyAndKeepNumericEnvelopeCode() throws Exception {
        var writer = new InternalServicePrincipal("client", "HACU", Set.of("tenant:provision", "tenant:policy:write"), Set.of(), true);
        String provision = """
            {"sourceSystem":"HACU","requestId":"request-converters","ownerUserId":"1","enterpriseName":"Test",
             "actor":{"type":"ADMIN","id":"actor"},"reason":"test","resourceSpec":{"profileKey":"s","bindingVersion":"1"},
             "initialPolicy":{"revision":"1","accessMode":"PREPARED","limits":{}}}
            """;
        mvc.perform(post("/internal/v1/tenant-provisionings").contentType("application/json").content(provision)
            .requestAttr(InternalServicePrincipal.ATTRIBUTE, writer)).andExpect(status().isAccepted())
            .andExpect(jsonPath("$.code").isNumber()).andExpect(jsonPath("$.code").value(0))
            .andExpect(jsonPath("$.data.commandId").value("10"));
        mvc.perform(put("/internal/v1/tenants/42/execution-policy").contentType("application/json")
            .content("{\"requestId\":\"request-converters-policy\",\"expectedRevision\":\"1\",\"policy\":{}}")
            .requestAttr(InternalServicePrincipal.ATTRIBUTE, writer)).andExpect(status().isAccepted())
            .andExpect(jsonPath("$.code").isNumber());
    }
    @Test void cookieCannotReplaceServiceIdentityAndErrorHasProblemDetails() throws Exception {
        mvc.perform(get("/internal/v1/tenants/42/enterprise").cookie(new jakarta.servlet.http.Cookie("JSESSIONID", "user-session")))
            .andExpect(status().isUnauthorized()).andExpect(content().contentTypeCompatibleWith("application/problem+json"))
            .andExpect(jsonPath("$.errorCode").value("SERVICE_AUTH_REQUIRED")).andExpect(jsonPath("$.traceId").isString())
            .andExpect(jsonPath("$.status").isNumber());
        org.junit.jupiter.api.Assertions.assertEquals(0, reads);
    }
    @Test void commandOwnershipChecksBothSourceAndTenant() throws Exception {
        command = new TenantCommandStore.Command("10", "OTHER", "request-123", "hash", "PROVISION", "42", "PENDING", "RESERVED", null, 1);
        mvc.perform(get("/internal/v1/commands/10").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.errorCode").value("SERVICE_SOURCE_DENIED"));
        command = new TenantCommandStore.Command("10", "HACU", "request-123", "hash", "PROVISION", "43", "PENDING", "RESERVED", null, 1);
        mvc.perform(get("/internal/v1/commands/10").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.errorCode").value("SERVICE_TENANT_DENIED"));
    }
    @Test void byRequestRejectsForeignSourceAndReturnsAuthorizedCommand() throws Exception {
        mvc.perform(get("/internal/v1/commands/by-request").param("sourceSystem", "OTHER").param("requestId", "request-123")
            .requestAttr(InternalServicePrincipal.ATTRIBUTE, principal)).andExpect(status().isForbidden());
        mvc.perform(get("/internal/v1/commands/by-request").param("sourceSystem", "HACU").param("requestId", "request-123")
            .requestAttr(InternalServicePrincipal.ATTRIBUTE, principal)).andExpect(status().isOk())
            .andExpect(jsonPath("$.data.commandId").value("10"));
    }
    @Test void overflowIsBadRequestAndMissingCommandIsNotFound() throws Exception {
        mvc.perform(get("/internal/v1/commands/9223372036854775808").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.errorCode").isString());
        mvc.perform(get("/internal/v1/commands/11").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
            .andExpect(status().isNotFound()).andExpect(jsonPath("$.errorCode").value("COMMAND_NOT_FOUND"));
    }
    @Test void tenantReadIsSafeAndRequiresCredentialScopeAndTarget() throws Exception {
        mvc.perform(get("/internal/v1/tenants/42/enterprise").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.enterpriseId").value("42"))
            .andExpect(jsonPath("$.data.enterpriseName").value("Safe enterprise"));
        mvc.perform(get("/internal/v1/tenants/43/enterprise").requestAttr(InternalServicePrincipal.ATTRIBUTE, principal))
            .andExpect(status().isForbidden());
        var noScope = new InternalServicePrincipal("client", "HACU", Set.of(), Set.of("42"), false);
        mvc.perform(get("/internal/v1/tenants/42/enterprise").requestAttr(InternalServicePrincipal.ATTRIBUTE, noScope))
            .andExpect(status().isForbidden()).andExpect(jsonPath("$.errorCode").value("SERVICE_SCOPE_DENIED"));
        org.junit.jupiter.api.Assertions.assertEquals(1, reads);
    }
    @Test void recoveryRequiresServiceSourceTenantAndWriteScope() throws Exception {
        mvc.perform(get("/internal/v1/commands/10/recovery")).andExpect(status().isUnauthorized());
        mvc.perform(get("/internal/v1/commands/10/recovery").requestAttr(InternalServicePrincipal.ATTRIBUTE,principal))
            .andExpect(status().isOk()).andExpect(jsonPath("$.data.decision").value("MANUAL_REQUIRED"));
        var wrongSource=new InternalServicePrincipal("client","OTHER",Set.of("tenant:read"),Set.of("42"),false);
        mvc.perform(get("/internal/v1/commands/10/recovery").requestAttr(InternalServicePrincipal.ATTRIBUTE,wrongSource)).andExpect(status().isForbidden());
        var wrongTenant=new InternalServicePrincipal("client","HACU",Set.of("tenant:read"),Set.of("99"),false);
        mvc.perform(get("/internal/v1/commands/10/recovery").requestAttr(InternalServicePrincipal.ATTRIBUTE,wrongTenant)).andExpect(status().isForbidden());
        mvc.perform(post("/internal/v1/commands/10/recoveries").contentType("application/json").content("{}")
            .requestAttr(InternalServicePrincipal.ATTRIBUTE,principal)).andExpect(status().isForbidden());
    }

}
