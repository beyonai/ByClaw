package com.iwhalecloud.byai.manager.application.service.user.base;

import static org.mockito.Mockito.*;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import java.util.List;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.context.ApplicationEventPublisher;
import org.springframework.test.util.ReflectionTestUtils;

class LocalUserSharedIdentityTest {
    static class Service extends BaseUserApplicationService {
        @Override public void initSuasSuperassist(Users user) { }
    }

    @ParameterizedTest @ValueSource(strings = {"saveUserAfter", "updateUserAfter"})
    void whaleAgentModeOnlyFillsMissingIdentity(String operation) {
        verifySync(operation, "WHALE_AGENT", true);
    }

    @ParameterizedTest @ValueSource(strings = {"saveUserAfter", "updateUserAfter"})
    void ordinaryModeKeepsExistingUserCacheUpdates(String operation) {
        verifySync(operation, "BYAI", false);
    }

    void verifySync(String operation, String mode, boolean fillOnly) {
        Service service = new Service();
        EnterpriseInfoService enterprise = mock(EnterpriseInfoService.class);
        when(enterprise.getEnterpriseId(81L)).thenReturn(1L);
        ReflectionTestUtils.setField(service, "enterpriseInfoService", enterprise);
        ReflectionTestUtils.setField(service, "eventPublisher", mock(ApplicationEventPublisher.class));
        ReflectionTestUtils.setField(service, "datasetSystem", mode);
        Users user = new Users(); user.setUserId(81L); user.setUserCode("newadmin"); user.setState("A");
        try (var cache = mockStatic(ShareCacheUtil.class)) {
            ReflectionTestUtils.invokeMethod(service, operation, user, List.of());
            if (fillOnly) {
                cache.verify(() -> ShareCacheUtil.ensureSharedUserIdentity(user, 1L));
                cache.verify(() -> ShareCacheUtil.setShareShareBfmUser(user, 1L), never());
            } else {
                cache.verify(() -> ShareCacheUtil.setShareShareBfmUser(user, 1L));
                cache.verify(() -> ShareCacheUtil.ensureSharedUserIdentity(user, 1L), never());
            }
        }
    }
}
