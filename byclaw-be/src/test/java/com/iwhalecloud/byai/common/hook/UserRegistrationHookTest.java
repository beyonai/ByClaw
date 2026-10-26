package com.iwhalecloud.byai.common.hook;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.bean.CasTicketUser;
import com.iwhalecloud.byai.manager.application.service.login.AppleLoginService;
import com.iwhalecloud.byai.manager.application.service.user.PhoneAccountRegistrationService;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketProvisioningService;
import com.iwhalecloud.byai.manager.application.service.user.hook.UserRegistrationHookConfiguration;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.sun.net.httpserver.HttpServer;
import java.net.InetSocketAddress;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.concurrent.LinkedBlockingQueue;
import java.util.concurrent.TimeUnit;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.annotation.AnnotationTransactionAttributeSource;
import org.springframework.transaction.interceptor.TransactionInterceptor;
import org.springframework.transaction.support.TransactionTemplate;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class UserRegistrationHookTest {
    private final LinkedBlockingQueue<String> requests = new LinkedBlockingQueue<>();

    @ParameterizedTest
    @ValueSource(strings = {"phone", "apple", "cas"})
    void newAccountPublishesOnlyWhitelistedFieldsThroughRealTransactionProxy(String source) throws Exception {
        withReceiver((context, database) -> {
            UserApplicationService service = registrationService(context.getBean(HookPublisher.class), database, false);
            Users created;
            if ("apple".equals(source)) {
                var apple = new AppleLoginService.AppleUserInfo();
                apple.setUserId("apple-user");
                apple.setUserName("Apple 用户");
                created = service.registerIosByPhone("13800138000", apple);
            } else if ("cas".equals(source)) {
                var cas = new CasTicketUser();
                cas.setUserName("cas-user");
                created = service.registerByCasTicketUser(cas);
            } else {
                created = service.registerByPhone("13800138000");
            }
            String body = requests.poll(5, TimeUnit.SECONDS);
            assertThat(body).isNotNull();
            var envelope = new ObjectMapper().readTree(body);
            assertThat(envelope.path("event").path("type").asText()).isEqualTo("user.registered");
            assertThat(envelope.path("data").path("userId").asText()).isEqualTo(created.getUserId().toString());
            assertThat(envelope.path("data").path("userId").isTextual()).isTrue();
            assertThat(envelope.path("data").path("registrationSource").asText()).isEqualTo(source);
            assertThat(envelope.path("data").fieldNames()).toIterable()
                .containsExactlyInAnyOrder("userId", "displayName", "registrationSource");
            assertThat(body).doesNotContain(created.getPwd(), "13800138000", "apple-user");
            assertThat(requests).isEmpty();
        });
    }

    @Test
    void databaseFailureAndInitializationFailureDoNotNotify() throws Exception {
        withReceiver((context, database) -> {
            org.mockito.Mockito.doThrow(new IllegalStateException("database unavailable")).when(database).save(any(Users.class));
            var service = registrationService(context.getBean(HookPublisher.class), database, false);
            assertThatThrownBy(() -> service.registerByPhone("13800138000")).isInstanceOf(IllegalStateException.class);
            org.mockito.Mockito.doNothing().when(database).save(any(Users.class));
            var failingInit = registrationService(context.getBean(HookPublisher.class), database, true);
            assertThatThrownBy(() -> failingInit.registerByPhone("13800138000")).isInstanceOf(IllegalStateException.class);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    @Test
    void existingPhoneLoginDoesNotNotify() throws Exception {
        withReceiver((context, database) -> {
            Users existing = new Users();
            existing.setUserId(42L);
            when(database.findAllByUserPhone("13800138000")).thenReturn(List.of(existing));
            var service = new PhoneAccountRegistrationService(mock(com.iwhalecloud.byai.common.lock.TransactionalRedisLockService.class), database,
                registrationService(context.getBean(HookPublisher.class), database, false));
            var tx = new TransactionTemplate(new HookIntegrationTest.TestTransactions());
            Users resolved = tx.execute(status -> service.resolveOrRegister("13800138000"));
            assertThat(resolved).isSameAs(existing);
            assertThat(requests.poll(200, TimeUnit.MILLISECONDS)).isNull();
        });
    }

    private UserApplicationService registrationService(HookPublisher hooks, UserService database, boolean failInit) {
        // Redis, buckets and sequence storage are external boundaries; retain real registration code and transaction advice.
        UserApplicationService target = new UserApplicationService() {
            @Override protected String getDefaultPwd() { return "test-default-password"; }
            @Override protected void saveUserAfter(Users user, List<UsersOrganization> organizations) {
                if (failInit) throw new IllegalStateException("initialization failed");
            }
        };
        SequenceService sequence = mock(SequenceService.class);
        when(sequence.nextVal()).thenReturn(9007199254740993L);
        ReflectionTestUtils.setField(target, "SequenceService", sequence);
        ReflectionTestUtils.setField(target, "userService", database);
        ReflectionTestUtils.setField(target, "userBucketProvisioningService", mock(UserBucketProvisioningService.class));
        ReflectionTestUtils.setField(target, "hookPublisher", hooks);
        ProxyFactory proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(new TransactionInterceptor(new HookIntegrationTest.TestTransactions(),
            new AnnotationTransactionAttributeSource()));
        return (UserApplicationService) proxy.getProxy();
    }

    private void withReceiver(RegistrationAssertions assertions) throws Exception {
        HttpServer server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/registered", exchange -> {
            requests.add(new String(exchange.getRequestBody().readAllBytes(), StandardCharsets.UTF_8));
            exchange.sendResponseHeaders(204, -1);
            exchange.close();
        });
        server.start();
        try {
            new ApplicationContextRunner().withUserConfiguration(HookConfiguration.class, UserRegistrationHookConfiguration.class)
                .withPropertyValues("byclaw.hooks.enabled=true", "byclaw.hooks.subscriptions.registration.event=user.registered",
                    "byclaw.hooks.subscriptions.registration.http.url=http://127.0.0.1:"
                        + server.getAddress().getPort() + "/registered")
                .run(context -> {
                    assertThat(context).hasNotFailed();
                    UserService database = mock(UserService.class);
                    assertions.check(context, database);
                });
        } finally {
            server.stop(0);
        }
    }

    @FunctionalInterface
    interface RegistrationAssertions {
        void check(org.springframework.boot.test.context.assertj.AssertableApplicationContext context,
            UserService database) throws Exception;
    }
}
