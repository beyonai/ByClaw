package com.iwhalecloud.byai.manager.application.service.openapi;

import com.iwhalecloud.byai.manager.application.service.user.UserBucketProvisioningService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenUserDTO;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class OpenUserApiApplicationServiceTest {

    @Test
    void addUserEnsuresMinioBucketAfterUserCreated() {
        TestOpenUserApiApplicationService service = new TestOpenUserApiApplicationService();
        UserService userService = mock(UserService.class);
        UserExternalSystemService userExternalSystemService = mock(UserExternalSystemService.class);
        SequenceService sequenceService = mock(SequenceService.class);
        UserBucketProvisioningService userBucketProvisioningService = mock(UserBucketProvisioningService.class);

        when(sequenceService.nextVal()).thenReturn(1001L, 1002L);

        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "userExternalSystemService", userExternalSystemService);
        ReflectionTestUtils.setField(service, "SequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "userBucketProvisioningService", userBucketProvisioningService);

        OpenUserDTO dto = new OpenUserDTO();
        dto.setNewPrimaryKey(true);
        dto.setUserId(9001L);
        dto.setUserCode("openuser001");
        dto.setUserName("开放用户");

        Long userId = service.addUser(dto);

        assertThat(userId).isEqualTo(1001L);
        assertThat(service.savedUserAfter).isTrue();
        verify(userService).save(any());
        verify(userBucketProvisioningService).ensureUserBucketQuietly("openuser001");
    }

    static class TestOpenUserApiApplicationService extends OpenUserApiApplicationService {
        private boolean savedUserAfter;

        @Override
        protected String getDefaultPwd() {
            return "defaultPwd";
        }

        @Override
        protected void saveUserAfter(Users users, List<UsersOrganization> usersOrganizations) {
            this.savedUserAfter = true;
        }
    }
}
