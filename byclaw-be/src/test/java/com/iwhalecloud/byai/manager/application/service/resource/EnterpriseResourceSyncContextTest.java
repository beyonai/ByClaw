package com.iwhalecloud.byai.manager.application.service.resource;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;

class EnterpriseResourceSyncContextTest {
    @BeforeEach void login() {
        var login = new LoginInfo(); login.setUserId(9L); login.setEnterpriseId(1L);
        CurrentUserHolder.setLoginInfo(login);
    }

    @AfterEach void cleanup() { CurrentUserHolder.setLoginInfo(null); }

    @Test void importExceptionIsLimitedToTheTrustedIdentityAndRestoredAfterFailure() {
        var auth = new AuthApplicationService();
        var target = resource(10L, "target");
        var unrelated = resource(11L, "other");
        assertThat(auth.hasResourceManagePermission(target)).isFalse();
        assertThatThrownBy(() -> EnterpriseResourceSyncContext.execute(true, "BYAI", "TOOLKIT", "target", () -> {
            assertThat(auth.hasResourceManagePermission(target)).isTrue();
            assertThat(auth.hasResourceManagePermission(unrelated)).isFalse();
            EnterpriseResourceSyncContext.execute(false, "BYAI", "TOOLKIT", "target", () -> {
                assertThat(EnterpriseResourceSyncContext.skipsImportEnterpriseCheck(target)).isFalse();
                assertThat(auth.hasResourceManagePermission(target)).isFalse();
                return null;
            });
            assertThat(auth.hasResourceManagePermission(target)).isTrue();
            throw new IllegalStateException("import failed");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(EnterpriseResourceSyncContext.canUpdate(target)).isFalse();
        assertThat(auth.hasResourceManagePermission(target)).isFalse();
    }

    @Test void untrustedImportNeverSkipsEnterpriseChecks() {
        var resource = resource(10L, "target");
        EnterpriseResourceSyncContext.execute(false, "BYAI", "TOOLKIT", "target", () -> {
            assertThat(EnterpriseResourceSyncContext.canUpdate(resource)).isFalse();
            assertThat(EnterpriseResourceSyncContext.skipsImportEnterpriseCheck(resource)).isFalse();
            return null;
        });
    }

    @Test void privateResourcesAndReviewSnapshotsRemainProtected() {
        var target = resource(10L, "target");
        target.setOwnerType("personal");
        EnterpriseResourceSyncContext.execute(true, "BYAI", "TOOLKIT", "target", () -> {
            assertThat(EnterpriseResourceSyncContext.canUpdate(target)).isFalse();
            return null;
        });
        target.setOwnerType("enterprise"); target.setResourceBizType("SKILL"); target.setResourceStatus(4);
        EnterpriseResourceSyncContext.execute(true, "BYAI", "SKILL", "target", () -> {
            assertThat(new AuthApplicationService().hasResourceManagePermission(target)).isFalse();
            return null;
        });
    }

    @Test void selectedUseCheckDoesNotChangeOtherResourcesAndRestoresAfterFailure() {
        var auth = new AuthApplicationService();
        var selected = resource(10L, "selected");
        var unrelated = resource(11L, "unrelated");
        assertThat(auth.hasResourceUsePermission(selected, 9L)).isFalse();
        assertThatThrownBy(() -> EnterpriseResourceSyncContext.checkUsePermission(selected, () -> {
            assertThat(auth.hasResourceUsePermission(selected, 9L)).isTrue();
            assertThat(auth.hasResourceUsePermission(unrelated, 9L)).isFalse();
            EnterpriseResourceSyncContext.checkUsePermission(unrelated, () -> {
                assertThat(EnterpriseResourceSyncContext.skipsUseEnterpriseCheck(selected)).isFalse();
                assertThat(auth.hasResourceUsePermission(unrelated, 9L)).isTrue();
                return null;
            });
            assertThat(auth.hasResourceUsePermission(selected, 9L)).isTrue();
            throw new IllegalStateException("permission check failed");
        })).isInstanceOf(IllegalStateException.class);
        assertThat(auth.hasResourceUsePermission(selected, 9L)).isFalse();
    }

    private SsResource resource(Long id, String code) {
        var resource = new SsResource();
        resource.setResourceId(id); resource.setResourceCode(code); resource.setSystemCode("BYAI");
        resource.setOwnerType("enterprise"); resource.setComAcctId(2L); resource.setCreateBy(9L);
        resource.setResourceBizType("TOOLKIT"); resource.setResourceStatus(2); resource.setUseAuthControlled(true);
        return resource;
    }
}
