package com.iwhalecloud.byai.common.concurrent;

import com.iwhalecloud.byai.common.datasource.config.CustomerContextHolder;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.assertThat;

class SandboxReconcileCompletionTest {
    @Test
    void completionPropagatesOnlyCurrentUserAndDatasourceAndDoesNotLeakBetweenCalls() {
        LoginInfo login = new LoginInfo();
        login.setUserCode("completion-user");
        CurrentUserHolder.setLoginInfo(login);
        CustomerContextHolder.setCustomerType(CustomerContextHolder.DATA_SOURCE_BYAI);
        SandboxReconcileCancellation.setDeadline(0);
        try {
            String user = SandboxReconcileCompletion.complete(() -> {
                assertThat(SandboxReconcileCancellation.isActive()).isFalse();
                assertThat(Thread.currentThread().isInterrupted()).isFalse();
                assertThat(CustomerContextHolder.getCustomerType()).isEqualTo(CustomerContextHolder.DATA_SOURCE_BYAI);
                return CurrentUserHolder.getCurrentUserCode();
            });
            assertThat(user).isEqualTo("completion-user");
        }
        finally {
            CurrentUserHolder.clearLoginInfo();
            CustomerContextHolder.clearCustomerType();
            SandboxReconcileCancellation.clear();
        }
        for (int i = 0; i < 4; i++) {
            assertThat(SandboxReconcileCompletion.complete(() -> {
                assertThat(CurrentUserHolder.getLoginInfo()).isNull();
                return CustomerContextHolder.getCustomerType();
            })).isNull();
        }
    }
}
