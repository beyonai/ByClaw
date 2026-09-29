package com.iwhalecloud.byai.manager.mapper.tenant;

import lombok.Data;

@Data
public class TenantMembershipRow {
    private String enterpriseId;
    private String enterpriseName;
    private String role;
    private String provisionStateJson;
}
