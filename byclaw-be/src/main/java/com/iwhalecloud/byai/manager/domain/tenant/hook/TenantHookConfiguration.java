package com.iwhalecloud.byai.manager.domain.tenant.hook;

import com.iwhalecloud.byai.common.hook.HookEventSchema;
import java.util.Set;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/** 租户创建表示企业记录完成预留，后续数据库和节点开通有独立生命周期。 */
@Configuration(proxyBeanMethods = false)
public class TenantHookConfiguration {
    @Bean
    public HookEventSchema tenantCreatedHookSchema() {
        return new HookEventSchema("tenant.created", 1, Set.of("enterpriseId", "enterpriseName", "packageId",
            "packageName", "createdBy", "requestId", "provisionState"));
    }
    @Bean
    public HookEventSchema tenantProvisioningCompletedSchema() {
        return new HookEventSchema("tenant.provisioning.completed", 1,
            Set.of("enterpriseId", "commandId", "stage"));
    }

    @Bean
    public HookEventSchema tenantProvisioningFailedSchema() {
        return new HookEventSchema("tenant.provisioning.failed", 1,
            Set.of("enterpriseId", "commandId", "stage", "errorCode"));
    }
}
