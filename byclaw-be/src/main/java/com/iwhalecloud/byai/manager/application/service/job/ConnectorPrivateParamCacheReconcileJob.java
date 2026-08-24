package com.iwhalecloud.byai.manager.application.service.job;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;

/** Periodically rebuilds connector-managed Redis parameters from authoritative database state. */
@Component
public class ConnectorPrivateParamCacheReconcileJob {

    private final UserPrivateParamApplicationService privateParamService;
    private final int batchSize;

    public ConnectorPrivateParamCacheReconcileJob(
            UserPrivateParamApplicationService privateParamService,
            @Value("${byai.connector.cache-refresh.reconcile-batch-size:100}") int batchSize) {
        this.privateParamService = privateParamService;
        this.batchSize = Math.max(1, batchSize);
    }

    @Scheduled(fixedDelayString = "${byai.connector.cache-refresh.reconcile-delay-millis:600000}")
    public void reconcileCaches() {
        privateParamService.reconcileConnectorManagedCaches(batchSize);
    }
}
