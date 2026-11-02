package com.iwhalecloud.byai.state.application.service.dataset;

import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.lock.TransactionalRedisLockService;
import com.iwhalecloud.byai.common.quota.HacuStoragePolicyReader;
import com.iwhalecloud.byai.manager.domain.operations.EnterpriseStorageService;
import com.iwhalecloud.byai.manager.mapper.operations.EnterpriseStorageMapper;
import org.springframework.data.redis.core.StringRedisTemplate;

import static org.mockito.Mockito.mock;

/** 旧知识库用例使用真实配额入口的非工作组分支，保持原文件行为。 */
public final class UnmanagedCloudQuotaFixture {
    private UnmanagedCloudQuotaFixture() {
    }

    public static WorkgroupStorageAdmission create(FeignPythonBuildService knowledge) {
        return new WorkgroupStorageAdmission(mock(EnterpriseStorageMapper.class), mock(HacuStoragePolicyReader.class),
            mock(EnterpriseStorageService.class), knowledge, mock(TransactionalRedisLockService.class),
            mock(StringRedisTemplate.class));
    }
}
