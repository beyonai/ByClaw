package com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream;

import com.dingtalk.api.response.OapiV2UserGetResponse;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.model.DingtalkCallbackMessage;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DingtalkUserServiceTest {

    private final UserService userService = mock(UserService.class);
    private final UserExternalSystemService externalSystemService = mock(UserExternalSystemService.class);
    private final EnterpriseInfoService enterpriseInfoService = mock(EnterpriseInfoService.class);
    private final SuasSuperassistService superassistService = mock(SuasSuperassistService.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final DingtalkTokenService tokenService = mock(DingtalkTokenService.class);
    private final DingtalkReplyDispatcher replyDispatcher = mock(DingtalkReplyDispatcher.class);
    private final DingtalkUserService service = spy(new DingtalkUserService());

    DingtalkUserServiceTest() {
        ReflectionTestUtils.setField(service, "userService", userService);
        ReflectionTestUtils.setField(service, "userExternalSystemService", externalSystemService);
        ReflectionTestUtils.setField(service, "enterpriseInfoService", enterpriseInfoService);
        ReflectionTestUtils.setField(service, "suasSuperassistService", superassistService);
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "dingtalkTokenService", tokenService);
        ReflectionTestUtils.setField(service, "dingtalkReplyDispatcher", replyDispatcher);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolveLoginInfoConsumesSuccessfulAccountSelectionMessage() throws Exception {
        DingtalkCallbackMessage message = message("选择 userCode=zhangsan");
        OapiV2UserGetResponse.UserGetResponse detail = userDetail();
        Users selectedUser = user(1001L, "zhangsan", "张三");
        Users otherUser = user(1002L, "zhangsan2", "张三");

        when(tokenService.getAccessToken("sender-001", "robot-001")).thenReturn("token");
        doReturn(detail).when(service).getUserDetail("token", "sender-001");
        when(userService.findByUserName("张三")).thenReturn(List.of(selectedUser, otherUser));
        when(enterpriseInfoService.getEnterpriseId()).thenReturn(88L);
        when(sequenceService.nextVal()).thenReturn(9001L);

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(externalSystemService).save(any(UserExternalSystem.class));
        verify(replyDispatcher).sendTextMessage(
                eq("https://oapi.dingtalk.com/robot/sendBySession"),
                eq("账号绑定成功，请重新发送您的问题。"));
    }

    @Test
    void saveUserExternalSystemToleratesConcurrentInsert() {
        OapiV2UserGetResponse.UserGetResponse detail = userDetail();
        UserExternalSystem concurrentBinding = new UserExternalSystem();
        concurrentBinding.setId(9002L);
        concurrentBinding.setUserId(1001L);
        when(externalSystemService.findByUnionId(any(), eq("union-001")))
                .thenReturn(null, concurrentBinding);
        doThrow(new DuplicateKeyException("duplicate binding"))
                .when(externalSystemService).save(any(UserExternalSystem.class));
        when(sequenceService.nextVal()).thenReturn(9001L);

        assertThatCode(() -> service.saveUserExternalSystem("union-001", 1001L, detail))
                .doesNotThrowAnyException();

        verify(externalSystemService, org.mockito.Mockito.times(2))
                .findByUnionId(any(), eq("union-001"));
    }

    @Test
    void resolveLoginInfoUsesSenderStaffIdBindingWithoutFetchingUserDetail() throws Exception {
        DingtalkCallbackMessage message = message("查询本月数据");
        UserExternalSystem binding = new UserExternalSystem();
        binding.setUserId(1001L);
        Users boundUser = user(1001L, "zhangsan", "张三");

        when(externalSystemService.findBySourceAccount(SourceType.DING_TALK, "sender-001"))
                .thenReturn(binding);
        when(userService.findById(1001L)).thenReturn(boundUser);
        when(enterpriseInfoService.getEnterpriseId()).thenReturn(88L);

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNotNull();
        assertThat(loginInfo.getUserId()).isEqualTo(1001L);
        verify(tokenService, never()).getAccessToken(any(), any());
    }

    @Test
    void resolveLoginInfoDoesNotReportSuccessWhenConcurrentBindingSelectsAnotherUser() throws Exception {
        DingtalkCallbackMessage message = message("选择 userCode=zhangsan");
        OapiV2UserGetResponse.UserGetResponse detail = userDetail();
        Users selectedUser = user(1001L, "zhangsan", "张三");
        Users otherCandidate = user(1002L, "zhangsan2", "张三");
        UserExternalSystem concurrentBinding = new UserExternalSystem();
        concurrentBinding.setUserId(1002L);

        when(externalSystemService.findBySourceAccount(any(), eq("sender-001"))).thenReturn(null);
        when(externalSystemService.findByUnionId(any(), eq("union-001")))
                .thenReturn(null, null, concurrentBinding);
        when(tokenService.getAccessToken("sender-001", "robot-001")).thenReturn("token");
        doReturn(detail).when(service).getUserDetail("token", "sender-001");
        when(userService.findByUserName("张三")).thenReturn(List.of(selectedUser, otherCandidate));
        when(sequenceService.nextVal()).thenReturn(9001L);
        doThrow(new DuplicateKeyException("duplicate binding"))
                .when(externalSystemService).save(any(UserExternalSystem.class));

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        verify(replyDispatcher).sendTextMessage(
                "https://oapi.dingtalk.com/robot/sendBySession",
                "账号绑定发生冲突，请重新发送消息。");
        verify(replyDispatcher, org.mockito.Mockito.never()).sendTextMessage(
                "https://oapi.dingtalk.com/robot/sendBySession",
                "账号绑定成功，请重新发送您的问题。");
    }

    @ParameterizedTest
    @CsvSource({
            "X, N",
            "A, Y"
    })
    void resolveLoginInfoRejectsInactiveOrLockedBoundUser(String state, String isLocked) throws Exception {
        DingtalkCallbackMessage message = message("查询本月数据");
        UserExternalSystem binding = new UserExternalSystem();
        binding.setUserId(1001L);
        Users boundUser = user(1001L, "zhangsan", "张三");
        boundUser.setState(state);
        boundUser.setIsLocked(isLocked);

        when(externalSystemService.findBySourceAccount(SourceType.DING_TALK, "sender-001"))
                .thenReturn(binding);
        when(userService.findById(1001L)).thenReturn(boundUser);

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(replyDispatcher).sendTextMessage(
                "https://oapi.dingtalk.com/robot/sendBySession",
                "系统账号已停用或锁定，请联系管理员。");
        verify(tokenService, never()).getAccessToken(any(), any());
    }

    @Test
    void resolveLoginInfoRejectsLockedUserBeforeCreatingBinding() throws Exception {
        DingtalkCallbackMessage message = message("查询本月数据");
        OapiV2UserGetResponse.UserGetResponse detail = userDetail();
        Users lockedUser = user(1001L, "zhangsan", "张三");
        lockedUser.setState("A");
        lockedUser.setIsLocked("Y");

        when(tokenService.getAccessToken("sender-001", "robot-001")).thenReturn("token");
        doReturn(detail).when(service).getUserDetail("token", "sender-001");
        when(userService.findByUserName("张三")).thenReturn(List.of(lockedUser));

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(replyDispatcher).sendTextMessage(
                "https://oapi.dingtalk.com/robot/sendBySession",
                "系统账号已停用或锁定，请联系管理员。");
        verify(externalSystemService, never()).save(any(UserExternalSystem.class));
    }

    private DingtalkCallbackMessage message(String textContent) {
        DingtalkCallbackMessage message = new DingtalkCallbackMessage();
        message.setSenderStaffId("sender-001");
        message.setRobotCode("robot-001");
        message.setSessionWebhook("https://oapi.dingtalk.com/robot/sendBySession");
        message.setTextContent(textContent);
        return message;
    }

    private OapiV2UserGetResponse.UserGetResponse userDetail() {
        OapiV2UserGetResponse.UserGetResponse detail = new OapiV2UserGetResponse.UserGetResponse();
        detail.setUserid("sender-001");
        detail.setUnionid("union-001");
        detail.setName("张三");
        return detail;
    }

    private Users user(Long userId, String userCode, String userName) {
        Users user = new Users();
        user.setUserId(userId);
        user.setUserCode(userCode);
        user.setUserName(userName);
        user.setState("A");
        user.setIsLocked("N");
        return user;
    }
}
