package com.iwhalecloud.byai.manager.application.service.job;

import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.application.service.user.UserPrivateParamApplicationService;

class ConnectorPrivateParamCacheReconcileJobTest {

    @Test
    void reconcilesConnectorManagedUsersWithConfiguredBatchSize() {
        UserPrivateParamApplicationService privateParamService =
            mock(UserPrivateParamApplicationService.class);
        ConnectorPrivateParamCacheReconcileJob job =
            new ConnectorPrivateParamCacheReconcileJob(privateParamService, 100);

        job.reconcileCaches();

        verify(privateParamService).reconcileConnectorManagedCaches(100);
    }
}
