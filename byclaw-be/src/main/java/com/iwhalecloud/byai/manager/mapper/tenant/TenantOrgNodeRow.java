package com.iwhalecloud.byai.manager.mapper.tenant;

import lombok.Data;

@Data
public class TenantOrgNodeRow {
    private Long orgId;
    private Long parentOrgId;
    private String orgName;
    private Integer orgIndex;
    private Integer memberCount;
    private Boolean attached;
}
