package com.iwhalecloud.byai.manager.config;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;
import java.util.concurrent.Future;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncAsyncConfig;
import com.iwhalecloud.byai.manager.application.service.devloop.IntegrationRunAsyncConfig;

class AsyncConfigTest {

    private final List<ThreadPoolTaskExecutor> executors = new ArrayList<>();

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        executors.forEach(ThreadPoolTaskExecutor::shutdown);
    }

    @Test
    void defaultExecutorCapturesEachTaskContextInsteadOfRetainingWorkerContext() throws Exception {
        ThreadPoolTaskExecutor executor = register((ThreadPoolTaskExecutor) new AsyncConfig().taskExecutor());

        setCurrentUser("user-a");
        List<Future<String>> warmups = new ArrayList<>();
        for (int i = 0; i < executor.getCorePoolSize(); i++) {
            warmups.add(executor.submit(CurrentUserHolder::getCurrentUserCode));
        }
        for (Future<String> warmup : warmups) {
            assertThat(warmup.get()).isEqualTo("user-a");
        }

        setCurrentUser("user-b");
        assertThat(executor.submit(CurrentUserHolder::getCurrentUserCode).get()).isEqualTo("user-b");

        CurrentUserHolder.clearLoginInfo();
        assertThat(executor.submit(CurrentUserHolder::getCurrentUserCode).get()).isNull();
    }

    @Test
    void namedExecutorsAlsoPropagateTaskContext() throws Exception {
        assertContextPropagation(register((ThreadPoolTaskExecutor) new AsyncConfig().projectInitExecutor()));
        assertContextPropagation(register((ThreadPoolTaskExecutor) new AsyncConfig().auditLogExecutor()));
        assertContextPropagation(
            register((ThreadPoolTaskExecutor) new AuthRedisSyncAsyncConfig().authRedisSyncExecutor()));
        assertContextPropagation(
            register((ThreadPoolTaskExecutor) new IntegrationRunAsyncConfig().integrationRunExecutor()));
    }

    private void assertContextPropagation(ThreadPoolTaskExecutor executor) throws Exception {
        setCurrentUser("request-user");
        assertThat(executor.submit(CurrentUserHolder::getCurrentUserCode).get()).isEqualTo("request-user");
        CurrentUserHolder.clearLoginInfo();
        assertThat(executor.submit(CurrentUserHolder::getCurrentUserCode).get()).isNull();
    }

    private ThreadPoolTaskExecutor register(ThreadPoolTaskExecutor executor) {
        executors.add(executor);
        return executor;
    }

    private void setCurrentUser(String userCode) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode(userCode);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }
}
