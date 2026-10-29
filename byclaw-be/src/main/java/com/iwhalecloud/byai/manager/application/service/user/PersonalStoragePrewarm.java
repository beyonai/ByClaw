package com.iwhalecloud.byai.manager.application.service.user;

import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.Executor;

import com.alibaba.ttl.threadpool.TtlExecutors;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.state.common.exception.StoragePreparingException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionSynchronization;
import org.springframework.transaction.support.TransactionSynchronizationManager;

/** Start cloud quota initialization after account creation commits, before its first login. */
@Service
public class PersonalStoragePrewarm {
    private static final Logger LOG = LoggerFactory.getLogger(PersonalStoragePrewarm.class);
    private final PlatformRemoteGateway platform;
    private final Executor executor;
    private final Set<String> pending = ConcurrentHashMap.newKeySet();

    public PersonalStoragePrewarm(PlatformRemoteGateway platform,
        @Qualifier("defaultAsyncExecutor") Executor executor) {
        this.platform = platform;
        this.executor = TtlExecutors.getTtlExecutor(executor);
    }

    public void afterCommit(String userCode) {
        if (userCode == null || userCode.isBlank() || !platform.isRemote()) return;
        String user = userCode.trim();
        if (TransactionSynchronizationManager.isSynchronizationActive()
            && TransactionSynchronizationManager.isActualTransactionActive()) {
            TransactionSynchronizationManager.registerSynchronization(new TransactionSynchronization() {
                @Override public void afterCommit() { submit(user); }
            });
        } else {
            submit(user);
        }
    }

    private void submit(String user) {
        if (!pending.add(user)) return;
        try {
            executor.execute(() -> {
                try {
                    // Admission reserves durably and returns preparing. No filesystem polling on this thread.
                    // Disabled NAS admission is a no-op in Platform; it does not reserve cloud resources.
                    platform.call("storage", "quota-check", platform.params(
                        "userCode", user, "operation", "CHAT", "requestedBytes", 0L));
                } catch (StoragePreparingException expected) {
                    LOG.info("个人网盘已提前申请，等待后台开通，userCode={}", user);
                } catch (RuntimeException failure) {
                    LOG.warn("个人网盘提前申请失败，登录时将重试，userCode={}, failureType={}",
                        user, failure.getClass().getSimpleName());
                } finally {
                    pending.remove(user);
                }
            });
        } catch (RuntimeException failure) {
            pending.remove(user);
            LOG.warn("个人网盘提前申请调度失败，userCode={}", user);
        }
    }
}
