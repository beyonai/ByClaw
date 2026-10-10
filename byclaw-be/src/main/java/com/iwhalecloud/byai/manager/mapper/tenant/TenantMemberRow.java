package com.iwhalecloud.byai.manager.mapper.tenant;

import lombok.Data;

@Data
public class TenantMemberRow {
    private Long userId;
    private String userCode;
    private String userName;
    private String role;
    private String status;
}
