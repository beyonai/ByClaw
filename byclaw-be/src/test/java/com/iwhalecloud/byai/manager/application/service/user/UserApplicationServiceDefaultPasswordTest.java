package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.ecrypt.MD5Utils;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class UserApplicationServiceDefaultPasswordTest {

    @Test
    void checkDefaultPwdSkipsWhenSwitchIsMissing() {
        TestableUserApplicationService service = serviceWithSwitch(null);
        Users users = users("user001", "irrelevant");

        assertThat(service.checkDefaultPwd(users)).isFalse();
        assertThat(service.defaultPwdCalls).isZero();
    }

    @Test
    void checkDefaultPwdSkipsWhenDefaultPasswordCannotBeDecrypted() {
        TestableUserApplicationService service = serviceWithSwitch(Constants.YES_VALUE_TRUE);
        service.decryptException = new RuntimeException("missing rsa config");
        Users users = users("user001", "irrelevant");

        assertThat(service.checkDefaultPwd(users)).isFalse();
        assertThat(service.defaultPwdCalls).isEqualTo(1);
    }

    @Test
    void checkDefaultPwdMatchesEncryptedDefaultPassword() {
        TestableUserApplicationService service = serviceWithSwitch(Constants.YES_VALUE_TRUE);
        service.defaultPwd = "123456";
        Users users = users("user001", MD5Utils.encrypt("123456", "user001"));

        assertThat(service.checkDefaultPwd(users)).isTrue();
        assertThat(service.defaultPwdCalls).isEqualTo(1);
    }

    private TestableUserApplicationService serviceWithSwitch(String checkDefaultPwd) {
        SystemConfigService systemConfigService = mock(SystemConfigService.class);
        when(systemConfigService.getStringParamValueByCode("CHECK_DEFAULT_PWD")).thenReturn(checkDefaultPwd);
        TestableUserApplicationService service = new TestableUserApplicationService();
        ReflectionTestUtils.setField(service, "systemConfigService", systemConfigService);
        return service;
    }

    private Users users(String userCode, String pwd) {
        Users users = new Users();
        users.setUserCode(userCode);
        users.setPwd(pwd);
        return users;
    }

    static class TestableUserApplicationService extends UserApplicationService {
        String defaultPwd;
        RuntimeException decryptException;
        int defaultPwdCalls;

        @Override
        protected String getDefaultPwd() {
            defaultPwdCalls++;
            if (decryptException != null) {
                throw decryptException;
            }
            return defaultPwd;
        }
    }
}
