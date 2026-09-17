package com.iwhalecloud.byai.manager.application.service.auth;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/** 回归权限响应契约：移除旧审核入口字段，保留独立的使用授权与申请权限。 */
class ResourceOperationPermissionsContractTest {
    @Test
    void serializesUsePermissionsWithoutLegacyAuditFlag() {
        ResourceOperationPermissionsVo permissions = new ResourceOperationPermissionsVo();
        permissions.setCanUseAuth(true);
        permissions.setCanApplyUse(false);
        JsonNode json = new ObjectMapper().valueToTree(permissions);

        assertThat(json.has("canAuditUse")).isFalse();
        assertThat(json.get("canUseAuth").asBoolean()).isTrue();
        assertThat(json.get("canApplyUse").asBoolean()).isFalse();
    }
}
