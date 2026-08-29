package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.lifecycle;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.config.DingtalkStreamProperties;
import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;

import java.util.HashMap;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

class DingtalkConnectionLockServiceTest {

    @Test
    void springCanCreateBeanWithProductionConstructor() {
        assertThatCode(() -> {
            try (AnnotationConfigApplicationContext context = new AnnotationConfigApplicationContext()) {
                context.getBeanFactory().registerSingleton("dingtalkStreamProperties", new DingtalkStreamProperties());
                context.registerBean(DingtalkConnectionLockService.class);

                context.refresh();

                assertThat(context.getBean(DingtalkConnectionLockService.class)).isNotNull();
            }
        }).doesNotThrowAnyException();
    }

    @Test
    void acquireRenewAndReleaseAlwaysUseTheSameOwnerToken() {
        FakeLeaseOperations operations = new FakeLeaseOperations();
        DingtalkConnectionLockService service = new DingtalkConnectionLockService(
                new DingtalkStreamProperties(), operations, "instance-a");
        String token = service.newOwnerToken();

        assertThat(service.acquire("robot-1", token)).isTrue();
        assertThat(service.renew("robot-1", token)).isTrue();
        assertThat(service.release("robot-1", token)).isTrue();
        assertThat(operations.values).isEmpty();
    }

    @Test
    void staleOwnerCannotRenewOrReleaseANewerLease() {
        FakeLeaseOperations operations = new FakeLeaseOperations();
        DingtalkConnectionLockService service = new DingtalkConnectionLockService(
                new DingtalkStreamProperties(), operations, "instance-a");

        assertThat(service.acquire("robot-1", "new-token")).isTrue();
        assertThat(service.renew("robot-1", "old-token")).isFalse();
        assertThat(service.release("robot-1", "old-token")).isFalse();
        assertThat(operations.values).containsValue("new-token");
    }

    private static final class FakeLeaseOperations implements DingtalkConnectionLockService.LeaseOperations {
        private final Map<String, String> values = new HashMap<>();

        @Override
        public boolean acquire(String key, String token, long ttlSeconds) {
            return values.putIfAbsent(key, token) == null;
        }

        @Override
        public boolean renew(String key, String token, long ttlSeconds) {
            return token.equals(values.get(key));
        }

        @Override
        public boolean release(String key, String token) {
            return values.remove(key, token);
        }
    }
}
