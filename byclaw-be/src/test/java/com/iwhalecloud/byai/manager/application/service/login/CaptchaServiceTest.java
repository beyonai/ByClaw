package com.iwhalecloud.byai.manager.application.service.login;

import com.iwhalecloud.byai.common.ecrypt.AesUtils;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.dto.auth.SmsCaptchaRequest;
import com.iwhalecloud.byai.manager.infrastructure.config.SmsRateLimitConfig;
import com.iwhalecloud.byai.manager.infrastructure.sms.AliyunSmsService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.Test;
import org.mockito.MockedStatic;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;
import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.HashMap;
import java.util.Map;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

class CaptchaServiceTest extends LoginMessageSourceTestSupport {
    @Test
    void successfulSendsReachLimitPerIpAndBusinessType() throws Exception {
        CaptchaService service = new CaptchaService();
        AliyunSmsService sender = mock(AliyunSmsService.class);
        ReflectionTestUtils.setField(service, "smsService", sender);
        ReflectionTestUtils.setField(service, "safeAccountMsgService", mock(SafeAccountMsgService.class));
        ReflectionTestUtils.setField(service, "SequenceService", mock(SequenceService.class));
        ReflectionTestUtils.setField(service, "smsRateLimitConfig", new SmsRateLimitConfig());
        when(sender.sendSms(anyString(), anyString(), anyString())).thenReturn(true);
        Map<String, String> counts = new HashMap<>();
        try (MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class, withSettings().mockMaker("mock-maker-inline"))) {
            redis.when(() -> RedisUtil.getString(anyString())).thenAnswer(i -> counts.get(i.getArgument(0)));
            redis.when(() -> RedisUtil.setString(anyString(), anyString(), anyLong(), any()))
                .thenAnswer(i -> { counts.put(i.getArgument(0), i.getArgument(1)); return null; });
            redis.when(() -> RedisUtil.increment(anyString())).thenAnswer(i -> {
                String key = i.getArgument(0);
                long next = Long.parseLong(counts.get(key)) + 1;
                counts.put(key, Long.toString(next));
                return next;
            });
            for (int i = 0; i < 3; i++) {
                assertThat(service.sendSmsCode(params("2"), request())).isTrue();
            }
            assertThatThrownBy(() -> service.sendSmsCode(params("2"), request()))
                .isInstanceOf(BaseException.class).hasMessage("sms.send.too.frequent");
            assertThat(service.sendSmsCode(params("1"), request())).isTrue();
            verify(sender, times(4)).sendSms(anyString(), anyString(), anyString());
            redis.verify(() -> RedisUtil.setString("sms:ip:type:count:127.0.0.1:2", "1", 5,
                java.util.concurrent.TimeUnit.MINUTES));
        }
    }

    static SmsCaptchaRequest params(String type) throws Exception {
        SmsCaptchaRequest param = new SmsCaptchaRequest();
        byte[] encrypted = AesUtils.encrypt("13800000000", AesUtils.AES_KEY.getBytes(StandardCharsets.UTF_8));
        param.setPhone(Base64.getEncoder().encodeToString(
            AesUtils.byteToHexString(encrypted).getBytes(StandardCharsets.UTF_8)));
        param.setCaptcha("1234");
        param.setBizType(type);
        return param;
    }

    static MockHttpServletRequest request() {
        MockHttpServletRequest request = new MockHttpServletRequest();
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("VERIFICATION_CODE", "1234");
        session.setAttribute("KAPTCHA_SESSION_DATE", System.currentTimeMillis());
        request.setSession(session);
        return request;
    }
}
