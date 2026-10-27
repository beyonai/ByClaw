package com.iwhalecloud.byai.manager.domain.tenant;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.hook.*;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.devloop.ProjectApplicationService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ProjectMemberService;
import com.iwhalecloud.byai.manager.entity.devloop.Project;
import com.iwhalecloud.byai.state.domain.groupchat.application.*;
import com.iwhalecloud.byai.state.domain.groupchat.authorization.GroupChatAuthorizationService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatCreateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.infrastructure.hook.WorkgroupHooks;
import com.iwhalecloud.byai.state.domain.groupchat.interfaces.GroupChatController;
import com.iwhalecloud.byai.state.domain.session.service.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.*;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.*;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.Mockito.*;
import static org.mockito.ArgumentMatchers.*;

class WorkgroupCreationHookTest {
    private final LinkedBlockingQueue<String> requests = new LinkedBlockingQueue<>();
    private final ProjectApplicationService projects = mock(ProjectApplicationService.class);
    private final SessionMemberService members = mock(SessionMemberService.class);
    private final TenantNodeClient node = mock(TenantNodeClient.class);
    private final TenantGroupData data = mock(TenantGroupData.class);
    private boolean failDetailRead;
    private HttpServer server;
    private ApplicationContextRunner runner;
    private final Transactions transactions = new Transactions();

    @BeforeEach
    void setup() throws Exception {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/hook", exchange -> {
            requests.add(new String(exchange.getRequestBody().readAllBytes(), java.nio.charset.StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1); exchange.close();
        });
        server.start();
        runner = new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, WorkgroupHooks.class)
            .withPropertyValues("byclaw.hooks.enabled=true", "byclaw.hooks.subscriptions.groups.event=workgroup.created",
                "byclaw.hooks.subscriptions.groups.http.url=http://127.0.0.1:" + server.getAddress().getPort() + "/hook");
        var login = new LoginInfo(); login.setUserId(9007199254740995L); login.setEnterpriseId(42L); CurrentUserHolder.setLoginInfo(login);
        var project = new Project(); project.setProjectId(9007199254740994L); project.setEnterpriseId(42L);
        project.setProjectName("工作组"); when(projects.createGroupChatProject(any())).thenReturn(project);
    }

    @AfterEach
    void cleanup() { CurrentUserHolder.clearLoginInfo(); server.stop(0); }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void bothCreationPathsSendOneWhitelistedEventAfterCommit(boolean tenant) {
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                create(tenant, context.getBean(WorkgroupHooks.class));
                assertThat(requests).isEmpty();
            });
            String raw = requests.poll(5, TimeUnit.SECONDS); assertThat(raw).isNotNull();
            var body = new ObjectMapper().readTree(raw);
            assertThat(body.path("event").path("type").asText()).isEqualTo("workgroup.created");
            assertThat(body.path("data").fieldNames()).toIterable().containsExactlyInAnyOrder(
                "groupId", "groupName", "projectId", "enterpriseId", "createdBy");
            assertThat(body.path("data").path("groupId").isTextual()).isTrue();
            assertThat(body.path("data").path("groupName").asText()).isEqualTo("工作组");
            assertThat(body.path("data").path("projectId").asText()).isEqualTo("9007199254740994");
            assertThat(body.path("data").path("createdBy").asText()).isEqualTo("9007199254740995");
            assertThat(body.path("data").path("enterpriseId").asText()).isEqualTo("42");
            assertThat(requests).isEmpty();
        });
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void rollbackNeverSends(boolean tenant) {
        runner.run(context -> {
            new TransactionTemplate(transactions).executeWithoutResult(status -> {
                create(tenant, context.getBean(WorkgroupHooks.class)); status.setRollbackOnly();
            });
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void failedCreationNeverSends(boolean tenant) {
        runner.run(context -> {
            when(projects.createGroupChatProject(any())).thenThrow(new IllegalStateException("creation failed"));
            assertThatThrownBy(() -> create(tenant, context.getBean(WorkgroupHooks.class))).isInstanceOf(IllegalStateException.class);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    /** 存储层默认企业不代表个人工作组的真实企业归属，对外事件必须保留空值。 */
    @Test
    void personalWorkgroupDoesNotPublishStorageDefaultAsEnterpriseOwnership() {
        var personal = new LoginInfo();
        personal.setUserId(9007199254740995L);
        personal.setComAcctId(1L);
        CurrentUserHolder.setLoginInfo(personal);
        var project = new Project();
        project.setProjectId(9007199254740994L);
        project.setEnterpriseId(1L);
        project.setProjectName("个人工作组");
        when(projects.createGroupChatProject(any())).thenReturn(project);
        runner.run(context -> {
            assertThat(context).hasNotFailed();
            create(false, context.getBean(WorkgroupHooks.class));
            String raw = requests.poll(5, TimeUnit.SECONDS);
            assertThat(raw).isNotNull();
            assertThat(new ObjectMapper().readTree(raw).path("data").path("enterpriseId").isNull()).isTrue();
        });
    }

    @Test
    void disabledHookDoesNotPreventGroupCreation() {
        runner.withPropertyValues("byclaw.hooks.enabled=false").run(context -> {
            create(false, context.getBean(WorkgroupHooks.class)); create(true, context.getBean(WorkgroupHooks.class));
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void tenantDetailFailureAfterNodeCreationDoesNotSend() {
        runner.run(context -> {
            failDetailRead = true;
            assertThatThrownBy(() -> create(true, context.getBean(WorkgroupHooks.class)))
                .isInstanceOf(IllegalStateException.class);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void memberWriteFailureAfterSessionCreationDoesNotSend() {
        runner.run(context -> {
            doThrow(new IllegalStateException("member insert failed")).when(members).batchSave(anyList());
            assertThatThrownBy(() -> create(false, context.getBean(WorkgroupHooks.class)))
                .isInstanceOf(IllegalStateException.class);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void externalWorkgroupYamlMapsEventToConfiguredRequest(@org.junit.jupiter.api.io.TempDir java.nio.file.Path directory)
        throws Exception {
        var config = directory.resolve("workgroup-hooks.yaml");
        java.nio.file.Files.copy(java.nio.file.Path.of("config/examples/hooks.yaml"), config);
        new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, WorkgroupHooks.class)
            .withInitializer(new org.springframework.boot.test.context.ConfigDataApplicationContextInitializer())
            .withPropertyValues("spring.config.additional-location=" + config.toUri(), "byclaw.hooks.enabled=true",
                "byclaw.hooks.subscriptions.registration-crm.enabled=false",
                "byclaw.hooks.subscriptions.workgroup-sync.enabled=true",
                "WORKGROUP_HOOK_SIGNING_SECRET=local-contract-test-signing-secret-32chars",
                "WORKGROUP_HOOK_ALLOW_LOOPBACK_HTTP=true",
                "WORKGROUP_CREATED_HOOK_URL=http://127.0.0.1:" + server.getAddress().getPort() + "/hook",
                "WORKGROUP_CREATED_HOOK_TOKEN=test-token").run(context -> {
                assertThat(context).hasNotFailed(); create(false, context.getBean(WorkgroupHooks.class));
                var body = new ObjectMapper().readTree(requests.poll(5, TimeUnit.SECONDS));
                assertThat(body.path("workgroupId").asText()).isEqualTo("9007199254740993");
                assertThat(body.path("groupName").asText()).isEqualTo("工作组");
                assertThat(body.path("eventId").asText()).isNotBlank();
            });
    }

    private void create(boolean tenant, WorkgroupHooks hooks) {
        var request = new GroupChatCreateRequest(); request.setName("工作组"); request.setGoal("不应发送的目标内容");
        if (tenant) {
            var tenantMembers = mock(TenantGroupMemberService.class);
            when(tenantMembers.prepareMembers(any(), anyString(), anyList())).thenReturn(List.of());
            when(tenantMembers.prepareCoordinatorMember(50L)).thenReturn(new TenantNodeModels.InvitedMember("AGENT", "50", "助手", true));
            var assistant = mock(GroupWorkAssistantService.class); when(assistant.resolveDefaultCoordinatorId()).thenReturn(50L);
            var target = new TenantGroupCreationService(node, data, tenantMembers, projects, mock(WorkgroupTemplateService.class),
                mock(AuthApplicationService.class));
            ReflectionTestUtils.setField(target, "groupWorkAssistant", assistant);
            ReflectionTestUtils.setField(target, "quotaAdmission", mock(com.iwhalecloud.byai.common.quota.SharedQuotaAdmission.class));
            ReflectionTestUtils.setField(target, "workgroupHooks", hooks);
            when(data.read(any(), anyString())).thenAnswer(invocation -> {
                if (failDetailRead) throw new IllegalStateException("detail unavailable");
                String path = invocation.getArgument(1);
                return new ObjectMapper().createObjectNode().set("session", new ObjectMapper().createObjectNode()
                    .put("sessionId", path.substring(path.lastIndexOf('/') + 1)).put("sessionName", "工作组")
                    .put("projectId", "9007199254740994").put("enterpriseId", "42").put("creatorId", "9007199254740995"));
            });
            proxy(target).create(new TenantRequestContext(9007199254740995L, 42L, "ADMIN"), request);
        } else {
            var sequence = mock(SequenceService.class); when(sequence.nextVal()).thenReturn(9007199254740993L);
            var target = new GroupChatApplicationService(mock(SessionService.class), sequence, mock(GroupChatAuthorizationService.class),
                members, projects, mock(ProjectMemberService.class), null, null, null, mock(SessionExtService.class));
            ReflectionTestUtils.setField(target, "quotaAdmission", mock(com.iwhalecloud.byai.common.quota.SharedQuotaAdmission.class));
            ReflectionTestUtils.setField(target, "workgroupHooks", hooks);
            var service = proxy(target);
            new GroupChatController(service, null, null, null).create(request);
        }
    }

    @SuppressWarnings("unchecked")
    private <T> T proxy(T target) {
        var proxy = new ProxyFactory(target); proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(transactions, new AnnotationTransactionAttributeSource()));
        return (T) proxy.getProxy();
    }

    static class Transactions extends AbstractPlatformTransactionManager {
        private final Object transaction = new Object();
        @Override protected Object doGetTransaction() { return transaction; }
        @Override protected boolean isExistingTransaction(Object tx) { return TransactionSynchronizationManager.isActualTransactionActive(); }
        @Override protected void doBegin(Object tx, TransactionDefinition definition) { }
        @Override protected void doCommit(DefaultTransactionStatus status) { }
        @Override protected void doRollback(DefaultTransactionStatus status) { }
    }
}
