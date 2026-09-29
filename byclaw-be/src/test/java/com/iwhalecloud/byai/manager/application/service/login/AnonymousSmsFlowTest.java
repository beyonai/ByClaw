package com.iwhalecloud.byai.manager.application.service.login;

import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.infrastructure.config.SmsRateLimitConfig;
import com.iwhalecloud.byai.manager.infrastructure.sms.AliyunSmsService;
import com.iwhalecloud.byai.manager.interfaces.controller.login.LoginController;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.state.infrastructure.filter.AccessTokenVerifyInterceptor;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import java.util.List;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.*;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class AnonymousSmsFlowTest extends LoginMessageSourceTestSupport {
    private MockMvc mvc;
    private AliyunSmsService sender;
    private SafeAccountMsgService records;

    @BeforeEach
    void setUp() {
        CaptchaService service = new CaptchaService();
        sender = mock(AliyunSmsService.class);
        records = mock(SafeAccountMsgService.class);
        ReflectionTestUtils.setField(service, "smsService", sender);
        ReflectionTestUtils.setField(service, "safeAccountMsgService", records);
        ReflectionTestUtils.setField(service, "SequenceService", mock(SequenceService.class));
        ReflectionTestUtils.setField(service, "smsRateLimitConfig", new SmsRateLimitConfig());
        LoginController controller = new LoginController();
        ReflectionTestUtils.setField(controller, "captchaService", service);
        AccessTokenVerifyInterceptor interceptor = new AccessTokenVerifyInterceptor();
        interceptor.init();
        mvc = MockMvcBuilders.standaloneSetup(controller).addInterceptors(interceptor).build();
    }

    @Test
    void anonymousCaptchaAndSameSessionSmsWorkAndCaptchaCannotBeReused() throws Exception {
        try (var redis = mockStatic(RedisUtil.class, withSettings().mockMaker("mock-maker-inline"))) {
            CaptchaServiceTest.allowRedis(redis);
            when(sender.sendSms(anyString(), anyString(), eq("register"))).thenReturn(true);
            MockHttpSession session = captcha();
            String code = (String) session.getAttribute("VERIFICATION_CODE");
            send(session, code, 0);
            assertThat(session.getAttribute("VERIFICATION_CODE")).isNull();
            send(session, code, -1).andExpect(jsonPath("$.msg").value("captcha.image.invalid"));
            verify(sender, times(1)).sendSms(anyString(), anyString(), eq("register"));
            verify(records).save(any(SafeAccountMsg.class));
        }
    }

    @Test
    void missingDifferentWrongAndExpiredCaptchaSessionsCannotSendSms() throws Exception {
        MockHttpSession original = captcha();
        send(new MockHttpSession(), (String) original.getAttribute("VERIFICATION_CODE"), -1)
            .andExpect(jsonPath("$.msg").value("captcha.image.invalid"));
        send(original, "wrong", -1).andExpect(jsonPath("$.msg").value("captcha.image.incorrect"));
        MockHttpSession expired = captcha();
        String code = (String) expired.getAttribute("VERIFICATION_CODE");
        expired.setAttribute("KAPTCHA_SESSION_DATE", System.currentTimeMillis() - 121000L);
        send(expired, code, -1).andExpect(jsonPath("$.msg").value("captcha.image.expired"));
        verifyNoInteractions(sender, records);
    }

    @Test
    void phoneCooldownAndPhoneLimitRemainEnforcedAnonymously() throws Exception {
        when(records.qryInterval(anyString(), eq("2"), anyInt())).thenReturn(List.of(new SafeAccountMsg()));
        MockHttpSession repeated = captcha();
        send(repeated, (String) repeated.getAttribute("VERIFICATION_CODE"), -1)
            .andExpect(jsonPath("$.msg").value("captcha.sms.repeat.send"));
        when(records.qryInterval(anyString(), eq("2"), anyInt())).thenReturn(List.of());
        try (var redis = mockStatic(RedisUtil.class, withSettings().mockMaker("mock-maker-inline"))) {
            redis.when(() -> RedisUtil.reserveAttempt("sms:phone:count:13800000000", 3, 300)).thenReturn(false);
            MockHttpSession limited = captcha();
            send(limited, (String) limited.getAttribute("VERIFICATION_CODE"), -1)
                .andExpect(jsonPath("$.msg").value("sms.send.too.frequent"));
        }
        verifyNoInteractions(sender);
    }

    private MockHttpSession captcha() throws Exception {
        var result = mvc.perform(get("/byaiService/system/session/captcha").contextPath("/byaiService"))
            .andExpect(status().isOk()).andExpect(content().contentType("image/png")).andReturn();
        assertThat(result.getResponse().getContentAsByteArray()).startsWith(
            (byte) 0x89, (byte) 0x50, (byte) 0x4e, (byte) 0x47);
        MockHttpSession session = (MockHttpSession) result.getRequest().getSession(false);
        assertThat(session).isNotNull();
        assertThat(session.getAttribute("VERIFICATION_CODE")).isNotNull();
        return session;
    }

    private org.springframework.test.web.servlet.ResultActions send(
            MockHttpSession session, String captcha, int expectedCode) throws Exception {
        var param = CaptchaServiceTest.params("2");
        param.setCaptcha(captcha);
        return mvc.perform(post("/byaiService/system/session/sms/send").contextPath("/byaiService")
                .session(session).contentType("application/json").content(JSON.toJSONString(param)))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(expectedCode));
    }
}
