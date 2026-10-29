package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import java.util.Date;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 在业务提交之后执行；失败有持久记录，重试只同步当前生效版本，不重放旧写入。 */
@Component
@Slf4j
public class EmployeeVersionSync {
    private final TransactionTemplate transaction;
    private final DigitalEmployeePublicationMapper locks;
    private final SsResourceMapper resources;
    private final EmployeeVersionActivationMapper activations;
    private final EmployeeVersionStore store;
    private final EmployeeVersionLock mutex;
    private final DigitalEmployeePostCommitRefreshExecutor executor;
    public EmployeeVersionSync(PlatformTransactionManager manager, DigitalEmployeePublicationMapper locks,
        SsResourceMapper resources, EmployeeVersionActivationMapper activations, EmployeeVersionStore store,
        DigitalEmployeePostCommitRefreshExecutor executor, EmployeeVersionLock mutex) {
        transaction = new TransactionTemplate(manager);
        transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.mutex = mutex;
        this.locks = locks; this.resources = resources; this.activations = activations; this.store = store; this.executor = executor;
    }
    public void refresh(Long resourceId) {
        SsResource initial = resources.selectById(resourceId);
        if (initial == null || initial.getPendingActivationId() == null) return;
        Long activationId = initial.getPendingActivationId();
        try {
            transaction.executeWithoutResult(status -> {
                mutex.acquire(initial.getComAcctId(), resourceId);
                SsResource resource = locks.lockResource(resourceId, initial.getComAcctId());
                if (resource == null || !activationId.equals(resource.getPendingActivationId())) return;
                var activation = store.pending(resource);
                var version = store.requireVersion(resource, resource.getResourceRVerid());
                var input = EmployeeVersionSnapshot.restore(version.getExtInfo(), store.current(resourceId));
                if (!"017".equals(input.getAgentType()) && !executor.refresh(resourceId, input))
                    throw new IllegalStateException("数字员工运行配置同步未完成");
                activation.setStatus("READY"); activation.setErrorMessage(null); activation.setCompletedAt(new Date());
                activation.setRetryCount(activation.getRetryCount() + 1); activations.updateById(activation);
                resources.update(null, new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, resourceId)
                    .eq(SsResource::getComAcctId, resource.getComAcctId()).eq(SsResource::getPendingActivationId, activationId)
                    .set(SsResource::getPendingActivationId, null));
            });
        } catch (RuntimeException error) {
            log.error("数字员工版本运行态同步失败，resourceId={}, activationId={}", resourceId, activationId, error);
            transaction.executeWithoutResult(status -> {
                mutex.acquire(initial.getComAcctId(), resourceId);
                SsResource resource = locks.lockResource(resourceId, initial.getComAcctId());
                if (resource == null || !activationId.equals(resource.getPendingActivationId())) return;
                var activation = store.pending(resource); activation.setStatus("SYNC_FAILED");
                activation.setErrorMessage("配置已生效，但运行态同步未完成，请重试同步；诊断编号：" + activationId);
                activation.setRetryCount(activation.getRetryCount() + 1); activations.updateById(activation);
            });
        }
    }
}
