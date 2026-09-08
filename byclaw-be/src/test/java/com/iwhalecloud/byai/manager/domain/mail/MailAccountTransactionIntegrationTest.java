package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.doAnswer;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.context.annotation.AnnotationConfigApplicationContext;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.annotation.EnableTransactionManagement;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.transaction.support.AbstractPlatformTransactionManager;
import org.springframework.transaction.support.DefaultTransactionStatus;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.mapper.users.UserMailAccountMapper;

class MailAccountTransactionIntegrationTest {
    @Test
    void committedOuterTransactionRunsRealRequiresNewCacheUpdate() {
        try (AnnotationConfigApplicationContext context =
                new AnnotationConfigApplicationContext(TestConfiguration.class)) {
            context.getBean(CommitCoordinator.class).saveAndSchedule(1001L, false);

            assertThat(context.getBean(CommittedStore.class).read("byai:user:mail_account:user-1001"))
                .contains("\"accounts\":[]");
        }
    }

    @Test
    void rolledBackOuterTransactionDoesNotRunProjectionCallback() {
        try (AnnotationConfigApplicationContext context =
                new AnnotationConfigApplicationContext(TestConfiguration.class)) {
            assertThatThrownBy(() -> context.getBean(CommitCoordinator.class)
                .saveAndSchedule(1002L, true)).isInstanceOf(IllegalStateException.class);

            assertThat(context.getBean(CommittedStore.class)
                .read("byai:user:mail_account:user-1002")).isNull();
        }
    }

    @Configuration(proxyBeanMethods = false)
    @EnableTransactionManagement
    static class TestConfiguration {
        @Bean
        CommittingTransactionManager transactionManager() {
            return new CommittingTransactionManager();
        }

        @Bean
        CommittedStore committedStore() {
            return new CommittedStore();
        }

        @Bean
        @SuppressWarnings("unchecked")
        MailAccountMetadataCacheTransactionService cacheTransactions(
                CommittingTransactionManager transactions, CommittedStore committed) {
            UserMailAccountMapper mapper = mock(UserMailAccountMapper.class);
            when(mapper.selectList(any())).thenReturn(List.of());
            LoginApplicationService logins = mock(LoginApplicationService.class);
            when(logins.getLoginInfo(anyLong())).thenAnswer(invocation -> {
                LoginInfo login = new LoginInfo();
                login.setUserCode("user-" + invocation.getArgument(0));
                return login;
            });
            StringRedisTemplate redis = mock(StringRedisTemplate.class);
            ValueOperations<String, String> values = mock(ValueOperations.class);
            when(redis.opsForValue()).thenReturn(values);
            doAnswer(invocation -> {
                String key = invocation.getArgument(0);
                String value = invocation.getArgument(1);
                transactions.onCommit(() -> committed.write(key, value));
                return null;
            }).when(values).set(anyString(), anyString());
            return new MailAccountMetadataCacheTransactionService(
                mapper, logins, redis, new ObjectMapper());
        }

        @Bean
        CommitCoordinator commitCoordinator(MailAccountMetadataCacheTransactionService transactions) {
            return new CommitCoordinator(transactions);
        }
    }

    static class CommitCoordinator {
        private final MailAccountMetadataCacheTransactionService transactions;

        CommitCoordinator(MailAccountMetadataCacheTransactionService transactions) {
            this.transactions = transactions;
        }

        @Transactional
        public void saveAndSchedule(Long userId, boolean fail) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override
                public void afterCommit() {
                    try {
                        transactions.refreshRequired(userId);
                    } catch (Exception e) {
                        throw new IllegalStateException(e);
                    }
                }
            });
            if (fail) throw new IllegalStateException("rollback");
        }
    }

    static class CommittedStore {
        private final Map<String, String> values = new LinkedHashMap<>();

        synchronized void write(String key, String value) {
            values.put(key, value);
        }

        synchronized String read(String key) {
            return values.get(key);
        }
    }

    static class CommittingTransactionManager extends AbstractPlatformTransactionManager {
        private final ThreadLocal<MemoryTransaction> current = new ThreadLocal<>();

        void onCommit(Runnable action) {
            MemoryTransaction transaction = current.get();
            if (transaction == null) throw new IllegalStateException("No transaction");
            transaction.commitActions.add(action);
        }

        @Override
        protected Object doGetTransaction() {
            MemoryTransaction transaction = current.get();
            return transaction == null ? new MemoryTransaction() : transaction;
        }

        @Override
        protected boolean isExistingTransaction(Object transaction) {
            return transaction == current.get();
        }

        @Override
        protected void doBegin(Object transaction, TransactionDefinition definition) {
            current.set((MemoryTransaction) transaction);
        }

        @Override
        protected Object doSuspend(Object transaction) {
            current.remove();
            return transaction;
        }

        @Override
        protected void doResume(Object transaction, Object suspendedResources) {
            current.set((MemoryTransaction) suspendedResources);
        }

        @Override
        protected void doCommit(DefaultTransactionStatus status) {
            MemoryTransaction transaction = (MemoryTransaction) status.getTransaction();
            transaction.commitActions.forEach(Runnable::run);
        }

        @Override
        protected void doRollback(DefaultTransactionStatus status) {
            ((MemoryTransaction) status.getTransaction()).commitActions.clear();
        }

        @Override
        protected void doCleanupAfterCompletion(Object transaction) {
            if (current.get() == transaction) current.remove();
        }
    }

    static class MemoryTransaction {
        private final List<Runnable> commitActions = new ArrayList<>();
    }
}
