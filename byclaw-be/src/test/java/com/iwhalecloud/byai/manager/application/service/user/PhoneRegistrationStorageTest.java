package com.iwhalecloud.byai.manager.application.service.user;

import com.iwhalecloud.byai.common.ecrypt.MD5Utils;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class PhoneRegistrationStorageTest {

    @Test
    void newPhoneAccountCanBeFoundByEncryptedPhoneWithoutChangingDefaultPassword() {
        UserService userService = mock(UserService.class);
        SequenceService sequenceService = mock(SequenceService.class);
        when(sequenceService.nextVal()).thenReturn(42L);
        UserApplicationService service = new UserApplicationService() {
            @Override protected String getDefaultPwd() { return "existing-default"; }
            @Override protected void saveUserAfter(Users users, List<UsersOrganization> organizations) { }
        };
        ReflectionTestUtils.setField(service, "SequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "userBucketProvisioningService", mock(UserBucketProvisioningService.class));

        service.registerByPhone("13800138000");

        ArgumentCaptor<Users> saved = ArgumentCaptor.forClass(Users.class);
        verify(userService).save(saved.capture());
        assertThat(saved.getValue().getPhone()).isEqualTo(Sm4Util.encrypt("13800138000"));
        assertThat(saved.getValue().getUserCode()).isEqualTo("13800138000");
        assertThat(saved.getValue().getState()).isEqualTo(UserState.ACTIVE);
        assertThat(saved.getValue().getPwd())
            .isEqualTo(MD5Utils.encrypt("existing-default", "13800138000"));
    }
}
