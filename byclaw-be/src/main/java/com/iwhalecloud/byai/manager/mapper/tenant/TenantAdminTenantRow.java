package com.iwhalecloud.byai.manager.mapper.tenant;

import lombok.Data;

@Data
public class TenantAdminTenantRow {
    private Long enterpriseId;
    private String enterpriseName;
    private String packageName;
    private String provisionStateJson;
    private String createdAt;
    private String openedAt;
    private String failureReason;
    private Long createdBy;
}
