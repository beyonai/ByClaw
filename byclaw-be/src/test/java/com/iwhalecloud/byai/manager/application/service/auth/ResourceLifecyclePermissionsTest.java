package com.iwhalecloud.byai.manager.application.service.auth;

import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.test.util.ReflectionTestUtils;
import static org.assertj.core.api.Assertions.assertThat;

/** 列表与单条查询共同调用的权限规则，状态与创建者身份必须同时满足。 */
class ResourceLifecyclePermissionsTest {
    @org.junit.jupiter.api.BeforeEach
    void clearUserContext() {
        com.iwhalecloud.byai.common.login.auth.CurrentUserHolder.clearLoginInfo();
    }

    @ParameterizedTest
    @CsvSource({
        "enterprise,2,10,false,true,false", "enterprise,3,10,true,false,true",
        "enterprise,0,10,true,false,true", "enterprise,3,20,true,false,false",
        "personal,2,10,false,false,true", "personal,3,10,false,false,true",
        "enterprise,-1,10,false,false,false", "enterprise,1,10,false,false,false"
    })
    void computesLifecyclePermissions(String ownerType, int status, long userId,
                                     boolean shelf, boolean unShelf, boolean delete) {
        AuthApplicationService service = new AuthApplicationService();
        SsResource resource = new SsResource();
        resource.setResourceId(1L);
        resource.setResourceBizType("TOOLKIT");
        resource.setResourceStatus(status);
        resource.setOwnerType(ownerType);
        resource.setCreateBy(10L);
        ResourceOperationPermissionsVo permissions = new ResourceOperationPermissionsVo();
        permissions.setCanDelete(true);
        permissions.setHasUsePermission(true);
        permissions.setCanApplyUse(true);
        ReflectionTestUtils.invokeMethod(service, "applyResourceCenterLifecyclePermissions", resource, permissions, userId);
        assertThat(permissions.isCanOnShelf()).isEqualTo(shelf);
        assertThat(permissions.isCanOffShelf()).isEqualTo(unShelf);
        assertThat(permissions.isCanDelete()).isEqualTo(delete);
        assertThat(permissions.isCanRestore()).isEqualTo(shelf);
        if (status != 2) {
            assertThat(permissions.isHasUsePermission()).isFalse();
            assertThat(permissions.isCanApplyUse()).isFalse();
            assertThat(service.hasResourceUsePermission(resource, 10L)).isFalse();
        }
    }
}
