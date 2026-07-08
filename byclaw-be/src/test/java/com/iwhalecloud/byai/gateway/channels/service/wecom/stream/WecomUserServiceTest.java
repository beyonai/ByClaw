package com.iwhalecloud.byai.gateway.channels.service.wecom.stream;

import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class WecomUserServiceTest {

    private static final String BOT_ID = "bot-001";

    private final UserService userService = mock(UserService.class);
    private final UserExternalSystemService externalSystemService = mock(UserExternalSystemService.class);
    private final EnterpriseInfoService enterpriseInfoService = mock(EnterpriseInfoService.class);
    private final SuasSuperassistService superassistService = mock(SuasSuperassistService.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final WecomContactUserService contactUserService = mock(WecomContactUserService.class);

    private final WecomUserService service = new WecomUserService(
            userService,
            externalSystemService,
            enterpriseInfoService,
            superassistService,
            sequenceService,
            contactUserService);

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolveLoginInfoAutoBindsFromWecomUserDetailWhenExternalBindingIsMissing() {
        String fromUserId = "zhangsan";
        Users user = user(1001L, "zhangsan", "张三");
        WecomUserDetail detail = new WecomUserDetail();
        detail.setUserid(fromUserId);
        detail.setName("张三");
        detail.setEmail("zhangsan@example.com");
        detail.setDepartment(List.of(1L));

        when(externalSystemService.findByUnionId(SourceType.WE_CHAT, fromUserId)).thenReturn(null);
        when(contactUserService.getUserDetail(BOT_ID, fromUserId)).thenReturn(detail);
        when(userService.findByUserCode(fromUserId)).thenReturn(user);
        when(enterpriseInfoService.getEnterpriseId()).thenReturn(88L);
        when(sequenceService.nextVal()).thenReturn(9001L);

        LoginInfo loginInfo = service.resolveLoginInfo(fromUserId, BOT_ID);

        assertThat(loginInfo).isNotNull();
        assertThat(loginInfo.getUserId()).isEqualTo(1001L);
        assertThat(loginInfo.getEnterpriseId()).isEqualTo(88L);

        ArgumentCaptor<UserExternalSystem> captor = ArgumentCaptor.forClass(UserExternalSystem.class);
        verify(externalSystemService).save(captor.capture());
        UserExternalSystem saved = captor.getValue();
        assertThat(saved.getId()).isEqualTo(9001L);
        assertThat(saved.getSourceType()).isEqualTo(SourceType.WE_CHAT);
        assertThat(saved.getUnionId()).isEqualTo(fromUserId);
        assertThat(saved.getUserId()).isEqualTo(1001L);
        assertThat(saved.getSourceAccount()).isEqualTo(fromUserId);
        assertThat(saved.getSourceNickname()).isEqualTo("张三");
        assertThat(saved.getSourceEmail()).isEqualTo("zhangsan@example.com");
        assertThat(saved.getSourceDepId()).isEqualTo("[1]");
        assertThat(saved.getBindingTime()).isNotNull();
    }

    @Test
    void resolveLoginInfoDoesNotAutoBindWhenWecomUserDetailCannotResolveLocalUser() {
        String fromUserId = "unknown";
        WecomUserDetail detail = new WecomUserDetail();
        detail.setUserid(fromUserId);
        detail.setName("重名用户");

        when(externalSystemService.findByUnionId(SourceType.WE_CHAT, fromUserId)).thenReturn(null);
        when(contactUserService.getUserDetail(BOT_ID, fromUserId)).thenReturn(detail);

        LoginInfo loginInfo = service.resolveLoginInfo(fromUserId, BOT_ID);

        assertThat(loginInfo).isNull();
        verify(externalSystemService, never()).save(org.mockito.ArgumentMatchers.any());
        verify(externalSystemService, never()).update(org.mockito.ArgumentMatchers.any());
    }

    @Test
    void resolveLoginInfoAutoBindsByEmailWhenUserIdAndMobileDoNotMatch() {
        String fromUserId = "external-user";
        Users user = user(1002L, "local-code", "李四");
        WecomUserDetail detail = new WecomUserDetail();
        detail.setUserid(fromUserId);
        detail.setEmail("lisi@example.com");

        when(externalSystemService.findByUnionId(SourceType.WE_CHAT, fromUserId)).thenReturn(null);
        when(contactUserService.getUserDetail(BOT_ID, fromUserId)).thenReturn(detail);
        when(userService.findByEmail("lisi@example.com")).thenReturn(user);
        when(enterpriseInfoService.getEnterpriseId()).thenReturn(88L);
        when(sequenceService.nextVal()).thenReturn(9002L);

        LoginInfo loginInfo = service.resolveLoginInfo(fromUserId, BOT_ID);

        assertThat(loginInfo).isNotNull();
        assertThat(loginInfo.getUserId()).isEqualTo(1002L);

        ArgumentCaptor<UserExternalSystem> captor = ArgumentCaptor.forClass(UserExternalSystem.class);
        verify(externalSystemService).save(captor.capture());
        assertThat(captor.getValue().getUnionId()).isEqualTo(fromUserId);
        assertThat(captor.getValue().getSourceEmail()).isEqualTo("lisi@example.com");
    }

    private Users user(Long userId, String userCode, String userName) {
        Users user = new Users();
        user.setUserId(userId);
        user.setUserCode(userCode);
        user.setUserName(userName);
        user.setAssistantId(userId);
        return user;
    }
}
