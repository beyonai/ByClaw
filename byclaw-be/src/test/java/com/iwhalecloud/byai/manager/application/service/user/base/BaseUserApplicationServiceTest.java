package com.iwhalecloud.byai.manager.application.service.user.base;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.Users;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class BaseUserApplicationServiceTest {

    private final TestUserApplicationService service = new TestUserApplicationService();

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void initSuasSuperassistOnlyCreatesSuperassistRecord() {
        SuasSuperassistService suasSuperassistService = mock(SuasSuperassistService.class);
        ReflectionTestUtils.setField(service, "suasSuperassistService", suasSuperassistService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        Users users = new Users();
        users.setUserId(8L);
        users.setUserName("张三");

        service.initSuasSuperassist(users);

        ArgumentCaptor<SuasSuperassist> captor = ArgumentCaptor.forClass(SuasSuperassist.class);
        verify(suasSuperassistService).addSuasSuperassist(captor.capture());
        assertThat(captor.getValue().getSuperassistId()).isEqualTo(8L);
        assertThat(captor.getValue().getSessionDatasetId()).isNull();
        assertThat(captor.getValue().getDefaultDigEmployeeId()).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(loginInfo);
    }

    static class TestUserApplicationService extends BaseUserApplicationService {
        @Override
        public void initSuasSuperassist(Users users) {
            super.initSuasSuperassist(users);
        }
    }
}
