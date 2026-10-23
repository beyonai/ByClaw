package com.iwhalecloud.byai.common.hook;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.domain.tenant.TenantAdminTenantService;
import com.iwhalecloud.byai.manager.domain.tenant.hook.TenantHookConfiguration;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantMapper;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantAdminTenantRow;
import com.iwhalecloud.byai.manager.mapper.tenant.TenantPackageRow;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.*;

/** Real tenant reservation and HTTP dispatch; external database operations remain mocked. */
class TenantCreationHookTest {
    private final LinkedBlockingQueue<String> requests = new LinkedBlockingQueue<>();
    private final TenantAdminTenantMapper database = mock(TenantAdminTenantMapper.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private HttpServer receiver;
    private ApplicationContextRunner runner;

    @BeforeEach
    void setup() throws Exception {
        receiver = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        receiver.createContext("/tenant", exchange -> {
            requests.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        receiver.start();
        runner = new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, TenantHookConfiguration.class)
            .withPropertyValues("byclaw.hooks.enabled=true", "byclaw.hooks.subscriptions.tenant.event=tenant.created",
                "byclaw.hooks.subscriptions.tenant.http.url=http://127.0.0.1:" + receiver.getAddress().getPort() + "/tenant");
        var organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        var login = new LoginInfo();
        login.setUserId(9007199254740995L);
        login.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(login);
        var plan = new TenantPackageRow();
        plan.setId(12L);
        plan.setPackageName("基础版");
        plan.setPackageContent("{\"profileKey\":\"s\",\"memberLimit\":10}");
        when(database.selectEnabledPackage(12L)).thenReturn(plan);
        when(sequence.nextVal()).thenReturn(9007199254740993L);
    }

    @AfterEach
    void cleanup() {
        CurrentUserHolder.clearLoginInfo();
        receiver.stop(0);
    }

    @Test
    void newTenantSendsWhitelistedSnapshotAfterTransactionCommit() {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            var service = service(context.getBean(HookPublisher.class));
            var provisioner = mock(com.iwhalecloud.byai.manager.domain.tenant.TenantDbProvisioningService.class);
            var controller = new com.iwhalecloud.byai.manager.interfaces.controller.tenant.TenantAdminTenantController(
                service, provisioner, mock(com.iwhalecloud.byai.manager.domain.tenant.TenantDeletionService.class));
            var view = controller.create(new com.iwhalecloud.byai.manager.interfaces.controller.tenant.TenantAdminTenantController
                .CreateTenantRequest("测试企业", 12L, "tenant-request-01")).getData();
            verify(provisioner).request(9007199254740993L);
            JsonNode body = new ObjectMapper().readTree(requests.poll(5, TimeUnit.SECONDS));
            assertThat(body.path("event").path("type").asText()).isEqualTo("tenant.created");
            assertThat(body.path("event").path("version").asInt()).isEqualTo(1);
            assertThat(body.path("data").path("enterpriseId").asText()).isEqualTo(view.enterpriseId());
            assertThat(body.path("data").path("enterpriseName").asText()).isEqualTo("测试企业");
            assertThat(body.path("data").path("enterpriseId").isTextual()).isTrue();
            assertThat(body.path("data").path("packageId").asText()).isEqualTo("12");
            assertThat(body.path("data").path("packageId").isTextual()).isTrue();
            assertThat(body.path("data").path("createdBy").asText()).isEqualTo("9007199254740995");
            assertThat(body.path("data").path("provisionState").asText()).isEqualTo("RESERVED");
            assertThat(body.path("data").fieldNames()).toIterable().containsExactlyInAnyOrder(
                "enterpriseId", "enterpriseName", "packageId", "packageName", "createdBy", "requestId", "provisionState");
            assertThat(requests).isEmpty();
        });
    }

    @Test
    void outerTransactionRollbackNeverSends() {
        runner.run(context -> {
            // The unproxied target joins this explicit outer transaction through HookPublisher synchronization.
            var target = new TenantAdminTenantService(database, sequence, new ObjectMapper(), context.getBean(HookPublisher.class));
            new TransactionTemplate(new HookIntegrationTest.TestTransactions()).executeWithoutResult(status -> {
                target.create("测试企业", 12L, "tenant-request-01");
                assertThat(requests).isEmpty();
                status.setRollbackOnly();
            });
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void idempotentRequestReturnsExistingTenantWithoutAnotherHook() {
        var existing = new TenantAdminTenantRow();
        existing.setEnterpriseId(9007199254740993L);
        existing.setEnterpriseName("测试企业");
        existing.setCreatedBy(9007199254740995L);
        existing.setPackageName("基础版");
        existing.setProvisionStateJson("{\"status\":\"RESERVED\"}");
        when(database.selectByRequestId("tenant-request-01")).thenReturn(existing);
        runner.run(context -> {
            assertThat(service(context.getBean(HookPublisher.class)).create("测试企业", 12L, "tenant-request-01")
                .enterpriseId()).isEqualTo("9007199254740993");
            verify(database, never()).insertEnterprise(anyLong(), org.mockito.ArgumentMatchers.anyString());
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void databaseFailureAndRejectedAccessNeverSend() {
        runner.run(context -> {
            var service = service(context.getBean(HookPublisher.class));
            doThrow(new IllegalStateException("database unavailable")).when(database)
                .insertOwner(anyLong(), anyLong(), anyLong());
            assertThatThrownBy(() -> service.create("测试企业", 12L, "tenant-request-01"))
                .isInstanceOf(IllegalStateException.class);
            CurrentUserHolder.clearLoginInfo();
            assertThatThrownBy(() -> service.create("测试企业", 12L, "tenant-request-02"))
                .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void globalSwitchOffStillCreatesTenantWithoutHttp() {
        runner.withPropertyValues("byclaw.hooks.enabled=false").run(context -> {
            assertThat(service(context.getBean(HookPublisher.class)).create("测试企业", 12L, "tenant-request-01")
                .enterpriseId()).isEqualTo("9007199254740993");
            assertThat(context).doesNotHaveBean(HookDispatcher.class);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void externalTenantYamlMapsConfiguredBodyAndHeaders(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory)
        throws Exception {
        var yaml = directory.resolve("tenant-hooks.yaml");
        java.nio.file.Files.copy(java.nio.file.Path.of("config/examples/hooks.yaml"), yaml);
        new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, TenantHookConfiguration.class)
            .withInitializer(new org.springframework.boot.test.context.ConfigDataApplicationContextInitializer())
            .withPropertyValues("spring.config.additional-location=" + yaml.toUri(), "byclaw.hooks.enabled=true",
                "byclaw.hooks.subscriptions.registration-crm.enabled=false",
                "byclaw.hooks.subscriptions.tenant-sync.enabled=true",
                "TENANT_CREATED_HOOK_URL=http://127.0.0.1:" + receiver.getAddress().getPort() + "/tenant",
                "TENANT_CREATED_HOOK_TOKEN=test-token").run(context -> {
                assertThat(context).hasNotFailed();
                service(context.getBean(HookPublisher.class)).create("测试企业", 12L, "tenant-request-01");
                JsonNode body = new ObjectMapper().readTree(requests.poll(5, TimeUnit.SECONDS));
                assertThat(body.path("enterpriseId").asText()).isEqualTo("9007199254740993");
                assertThat(body.path("enterpriseName").asText()).isEqualTo("测试企业");
                assertThat(body.path("eventId").asText()).isNotBlank();
            });
    }

    private TenantAdminTenantService service(HookPublisher publisher) {
        var target = new TenantAdminTenantService(database, sequence, new ObjectMapper(), publisher);
        var proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(new HookIntegrationTest.TestTransactions(),
            new AnnotationTransactionAttributeSource()));
        return (TenantAdminTenantService) proxy.getProxy();
    }
}
