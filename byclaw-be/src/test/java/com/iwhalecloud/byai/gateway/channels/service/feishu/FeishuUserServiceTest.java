package com.iwhalecloud.byai.gateway.channels.service.feishu;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuCallbackMessage;
import com.iwhalecloud.byai.gateway.channels.service.feishu.model.FeishuUserDetail;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import okhttp3.Call;
import okhttp3.MediaType;
import okhttp3.OkHttpClient;
import okhttp3.Protocol;
import okhttp3.Request;
import okhttp3.Response;
import okhttp3.ResponseBody;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.test.util.ReflectionTestUtils;

import java.io.IOException;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class FeishuUserServiceTest {

    private final UserService userService = mock(UserService.class);
    private final UserExternalSystemService externalSystemService = mock(UserExternalSystemService.class);
    private final EnterpriseInfoService enterpriseInfoService = mock(EnterpriseInfoService.class);
    private final SuasSuperassistService superassistService = mock(SuasSuperassistService.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final FeishuTokenService tokenService = mock(FeishuTokenService.class);
    private final FeishuReplyDispatcher replyDispatcher = mock(FeishuReplyDispatcher.class);
    private final OkHttpClient okHttpClient = mock(OkHttpClient.class);
    private final FeishuUserService service = new FeishuUserService(
            new ObjectMapper(),
            userService,
            externalSystemService,
            enterpriseInfoService,
            superassistService,
            sequenceService,
            tokenService,
            replyDispatcher
    );

    FeishuUserServiceTest() {
        ReflectionTestUtils.setField(service, "okHttpClient", okHttpClient);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void resolveMobileCandidates_keepsRawMobileAndAddsMainlandChinaLocalNumber() {
        List<String> candidates = ReflectionTestUtils.invokeMethod(
                service,
                "resolveMobileCandidates",
                "+8615920550664"
        );

        assertEquals(List.of("+8615920550664", "8615920550664", "15920550664"), candidates);
    }

    @Test
    void resolveEmployeeNoCandidates_usesUserIdWhenEmployeeNoIsMissing() {
        FeishuUserDetail userDetail = new FeishuUserDetail();
        userDetail.setUserId("0027023754");

        List<String> candidates = ReflectionTestUtils.invokeMethod(
                service,
                "resolveEmployeeNoCandidates",
                userDetail
        );

        assertEquals(List.of("0027023754"), candidates);
    }

    @Test
    void resolveLoginInfoConsumesSuccessfulAccountSelectionMessage() throws Exception {
        FeishuCallbackMessage message = message("选择 userCode=zhangsan");
        stubUserDetail();
        Users selectedUser = user(1001L, "zhangsan", "张三");
        Users otherUser = user(1002L, "zhangsan2", "张三");
        when(userService.findByUserName("张三")).thenReturn(List.of(selectedUser, otherUser));
        when(sequenceService.nextVal()).thenReturn(9001L);

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(externalSystemService).save(any(UserExternalSystem.class));
        verify(replyDispatcher).replyTextMessage("tenant-token", "message-001", "账号绑定成功，请重新发送您的问题。");
    }

    @Test
    void resolveLoginInfoRejectsUnavailableBoundUser() throws Exception {
        FeishuCallbackMessage message = message("查询本月数据");
        UserExternalSystem binding = new UserExternalSystem();
        binding.setUserId(1001L);
        Users disabledUser = user(1001L, "zhangsan", "张三");
        disabledUser.setState("X");
        when(externalSystemService.findByUnionId(SourceType.FEISHU, "open-001")).thenReturn(binding);
        when(userService.findById(1001L)).thenReturn(disabledUser);

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(replyDispatcher).replyTextMessage("tenant-token", "message-001", "系统账号已停用或锁定，请联系管理员。");
        verify(okHttpClient, never()).newCall(any());
    }

    @Test
    void resolveLoginInfoRejectsLockedUserBeforeCreatingBinding() throws Exception {
        FeishuCallbackMessage message = message("查询本月数据");
        stubUserDetail();
        Users lockedUser = user(1001L, "zhangsan", "张三");
        lockedUser.setIsLocked("Y");
        when(userService.findByUserName("张三")).thenReturn(List.of(lockedUser));

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(replyDispatcher).replyTextMessage("tenant-token", "message-001", "系统账号已停用或锁定，请联系管理员。");
        verify(externalSystemService, never()).save(any(UserExternalSystem.class));
    }

    @Test
    void resolveLoginInfoDoesNotReportSuccessWhenConcurrentBindingSelectsAnotherUser() throws Exception {
        FeishuCallbackMessage message = message("选择 userCode=zhangsan");
        stubUserDetail();
        Users selectedUser = user(1001L, "zhangsan", "张三");
        Users otherUser = user(1002L, "zhangsan2", "张三");
        UserExternalSystem concurrentBinding = new UserExternalSystem();
        concurrentBinding.setUserId(1002L);
        when(userService.findByUserName("张三")).thenReturn(List.of(selectedUser, otherUser));
        when(externalSystemService.findByUnionId(SourceType.FEISHU, "union-001"))
                .thenReturn(null, null, concurrentBinding);
        when(sequenceService.nextVal()).thenReturn(9001L);
        doThrow(new DuplicateKeyException("duplicate binding"))
                .when(externalSystemService).save(any(UserExternalSystem.class));

        LoginInfo loginInfo = service.resolveLoginInfo(message);

        assertThat(loginInfo).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isNull();
        verify(replyDispatcher).replyTextMessage("tenant-token", "message-001", "账号绑定发生冲突，请重新发送消息。");
        verify(replyDispatcher, never()).replyTextMessage(
                "tenant-token", "message-001", "账号绑定成功，请重新发送您的问题。");
    }

    private FeishuCallbackMessage message(String textContent) {
        FeishuCallbackMessage message = new FeishuCallbackMessage();
        message.setAppId("app-001");
        message.setMessageId("message-001");
        message.setSenderOpenId("open-001");
        message.setTextContent(textContent);
        when(tokenService.getTenantAccessToken("app-001")).thenReturn("tenant-token");
        return message;
    }

    private void stubUserDetail() throws IOException {
        String json = "{\"code\":0,\"data\":{\"user\":{\"open_id\":\"open-001\","
                + "\"union_id\":\"union-001\",\"user_id\":\"user-001\",\"name\":\"张三\"}}}";
        ResponseBody body = ResponseBody.create(json, MediaType.get("application/json"));
        Response response = new Response.Builder()
                .request(new Request.Builder().url("https://open.feishu.cn/test").build())
                .protocol(Protocol.HTTP_1_1)
                .code(200)
                .message("OK")
                .body(body)
                .build();
        Call call = mock(Call.class);
        when(call.execute()).thenReturn(response);
        when(okHttpClient.newCall(any())).thenReturn(call);
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
