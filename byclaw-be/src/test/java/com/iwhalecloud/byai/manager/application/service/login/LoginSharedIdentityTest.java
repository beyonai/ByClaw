package com.iwhalecloud.byai.manager.application.service.login;

import static org.mockito.Mockito.*;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

class LoginSharedIdentityTest {
    @ParameterizedTest @ValueSource(booleans = {false, true})
    void repairsOnlyVerifiedDatabaseIdentityInWhaleAgentMode(boolean whale) {
        LoginApplicationService service = new LoginApplicationService();
        UserService users = mock(UserService.class);
        EnterpriseInfoService enterprises = mock(EnterpriseInfoService.class);
        ReflectionTestUtils.setField(service, "datasetSystem", whale ? "WHALE_AGENT" : "BYAI");
        ReflectionTestUtils.setField(service, "userService", users);
        ReflectionTestUtils.setField(service, "enterpriseInfoService", enterprises);
        Users user = new Users(); user.setUserId(81L); user.setUserCode("local-user"); user.setState("A");
        when(users.findById(81L)).thenReturn(user); when(enterprises.getEnterpriseId(81L)).thenReturn(1L);
        LoginInfo login = new LoginInfo(); login.setUserId(81L); login.setUserCode("local-user"); login.setEnterpriseId(99L);
        try (var cache = mockStatic(ShareCacheUtil.class)) {
            service.shareSession(new MockHttpSession(), login);
            if (whale) cache.verify(() -> ShareCacheUtil.ensureSharedUserIdentity(user, 1L));
            else { cache.verifyNoInteractions(); verifyNoInteractions(users, enterprises); }
        }
    }

    @ParameterizedTest @ValueSource(booleans = {false, true})
    void missingOrMismatchedDatabaseIdentityIsNotPublished(boolean missing) {
        LoginApplicationService service = new LoginApplicationService();
        UserService users = mock(UserService.class);
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");
        ReflectionTestUtils.setField(service, "userService", users);
        Users user = new Users(); user.setUserCode("different-user");
        when(users.findById(81L)).thenReturn(missing ? null : user);
        LoginInfo login = new LoginInfo(); login.setUserId(81L); login.setUserCode("local-user");
        try (var cache = mockStatic(ShareCacheUtil.class)) {
            service.shareSession(new MockHttpSession(), login);
            cache.verifyNoInteractions();
        }
    }
}
