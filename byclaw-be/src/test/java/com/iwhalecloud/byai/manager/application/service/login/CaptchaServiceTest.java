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
    void rejectsUnsupportedBusinessTypeBeforeSending() throws Exception {
        CaptchaService service = service(mock(AliyunSmsService.class), mock(SafeAccountMsgService.class));

        assertThatThrownBy(() -> service.sendSmsCode(params("unexpected"), request()))
            .isInstanceOf(BaseException.class)
            .hasMessage("sms.type.unsupported");
    }

    @Test
    void rejectsMalformedEncryptedPhoneBeforeSending() {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        CaptchaService service = service(sender, records);
        SmsCaptchaRequest request = new SmsCaptchaRequest();
        request.setPhone("not-base64");
        request.setCaptcha("1234");
        request.setBizType("2");

        assertThatThrownBy(() -> service.sendSmsCode(request, request()))
            .isInstanceOf(BaseException.class)
            .hasMessage("phone.format.invalid");
        verifyNoInteractions(sender, records);
    }

    @Test
    void doesNotCallSmsProviderWhenInitialRecordCannotBeSaved() throws Exception {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        doThrow(new IllegalStateException("database unavailable")).when(records).save(any());
        CaptchaService service = service(sender, records);

        try (MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class, withSettings().mockMaker("mock-maker-inline"))) {
            allowRedis(redis);
            assertThatThrownBy(() -> service.sendSmsCode(params("2"), request()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessage("database unavailable");
        }
        verifyNoInteractions(sender);
    }

    @Test
    void samePhoneSharesQuotaAcrossBusinessTypesAndClientIps() throws Exception {
        CaptchaService service = new CaptchaService();
        AliyunSmsService sender = mock(AliyunSmsService.class);
        ReflectionTestUtils.setField(service, "smsService", sender);
        ReflectionTestUtils.setField(service, "safeAccountMsgService", mock(SafeAccountMsgService.class));
        ReflectionTestUtils.setField(service, "SequenceService", mock(SequenceService.class));
        ReflectionTestUtils.setField(service, "smsRateLimitConfig", new SmsRateLimitConfig());
        when(sender.sendSms(anyString(), anyString(), anyString())).thenReturn(true);
        Map<String, String> counts = new HashMap<>();
        try (MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class, withSettings().mockMaker("mock-maker-inline"))) {
            allowRedis(redis);
            redis.when(() -> RedisUtil.reserveAttempt(anyString(), anyInt(), anyLong())).thenAnswer(i -> {
                String key = i.getArgument(0);
                long next = Long.parseLong(counts.getOrDefault(key, "0")) + 1;
                counts.put(key, Long.toString(next));
                return next <= 3;
            });
            for (int i = 0; i < 3; i++) {
                assertThat(service.sendSmsCode(params("2"), request())).isTrue();
            }
            assertThatThrownBy(() -> service.sendSmsCode(params("2"), request()))
                .isInstanceOf(BaseException.class).hasMessage("sms.send.too.frequent");
            MockHttpServletRequest otherIp = request();
            otherIp.setRemoteAddr("203.0.113.9");
            otherIp.addHeader("X-Forwarded-For", "198.51.100.1");
            assertThatThrownBy(() -> service.sendSmsCode(params("1"), otherIp))
                .isInstanceOf(BaseException.class).hasMessage("sms.send.too.frequent");
            assertThat(service.sendSmsCode(params("1", "13900000000"), request())).isTrue();
            verify(sender, times(4)).sendSms(anyString(), anyString(), anyString());
            redis.verify(() -> RedisUtil.reserveAttempt("sms:phone:count:13800000000", 3, 300), times(5));
        }
    }

    static SmsCaptchaRequest params(String type) throws Exception {
        return params(type, "13800000000");
    }

    static SmsCaptchaRequest params(String type, String phone) throws Exception {
        SmsCaptchaRequest param = new SmsCaptchaRequest();
        byte[] encrypted = AesUtils.encrypt(phone, AesUtils.AES_KEY.getBytes(StandardCharsets.UTF_8));
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

    private static CaptchaService service(AliyunSmsService sender, SafeAccountMsgService records) {
        CaptchaService service = new CaptchaService();
        ReflectionTestUtils.setField(service, "smsService", sender);
        ReflectionTestUtils.setField(service, "safeAccountMsgService", records);
        ReflectionTestUtils.setField(service, "SequenceService", mock(SequenceService.class));
        ReflectionTestUtils.setField(service, "smsRateLimitConfig", new SmsRateLimitConfig());
        return service;
    }

    static void allowRedis(MockedStatic<RedisUtil> redis) {
        redis.when(() -> RedisUtil.reserveAttempt(anyString(), anyInt(), anyLong())).thenReturn(true);
        redis.when(() -> RedisUtil.setIfAbsent(anyString(), anyString(), anyLong())).thenReturn(true);
    }

    @Test
    void storesNonUsableRecordBeforeSendingAndActivatesOnlyAfterSuccess() throws Exception {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        java.util.List<String> events = new java.util.ArrayList<>();
        doAnswer(i -> { events.add("save:" + ((com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg) i.getArgument(0)).getState()); return null; })
            .when(records).save(any());
        when(sender.sendSms(anyString(), anyString(), anyString())).thenAnswer(i -> { events.add("send"); return true; });
        doAnswer(i -> { events.add("update:" + ((com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg) i.getArgument(0)).getState()); return null; })
            .when(records).update(any());
        try (var redis = mockStatic(RedisUtil.class)) {
            allowRedis(redis);
            assertThat(service(sender, records).sendSmsCode(params("2"), request())).isTrue();
        }
        assertThat(events).containsExactly("save:2", "send", "update:1");
    }

    @Test
    void providerFailureNeverActivatesCodeAndStillConsumesAttempt() throws Exception {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        when(sender.sendSms(anyString(), anyString(), anyString())).thenReturn(false);
        try (var redis = mockStatic(RedisUtil.class)) {
            allowRedis(redis);
            assertThatThrownBy(() -> service(sender, records).sendSmsCode(params("2"), request()))
                .isInstanceOf(BaseException.class).hasMessage("sms.send.failed");
            redis.verify(() -> RedisUtil.reserveAttempt("sms:phone:count:13800000000", 3, 300));
        }
        verify(records, never()).update(any());
    }

    @Test
    void providerExceptionLeavesInitialRecordUnusable() throws Exception {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        when(sender.sendSms(anyString(), anyString(), anyString())).thenThrow(new BaseException("sms.send.failed"));
        try (var redis = mockStatic(RedisUtil.class)) {
            allowRedis(redis);
            assertThatThrownBy(() -> service(sender, records).sendSmsCode(params("2"), request()))
                .isInstanceOf(BaseException.class);
        }
        verify(records).save(argThat(record -> "2".equals(record.getState())));
        verify(records, never()).update(any());
    }

    @Test
    void activationFailureIsReturnedWithoutResending() throws Exception {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        when(sender.sendSms(anyString(), anyString(), anyString())).thenReturn(true);
        doThrow(new IllegalStateException("update failed")).when(records).update(any());
        try (var redis = mockStatic(RedisUtil.class)) {
            allowRedis(redis);
            assertThatThrownBy(() -> service(sender, records).sendSmsCode(params("2"), request()))
                .isInstanceOf(IllegalStateException.class).hasMessage("update failed");
        }
        verify(sender, times(1)).sendSms(anyString(), anyString(), anyString());
    }

    @Test
    void unavailableQuotaOrPhoneReservationPreventsSending() throws Exception {
        AliyunSmsService sender = mock(AliyunSmsService.class);
        SafeAccountMsgService records = mock(SafeAccountMsgService.class);
        CaptchaService service = service(sender, records);
        try (var redis = mockStatic(RedisUtil.class)) {
            assertThatThrownBy(() -> service.sendSmsCode(params("2"), request()))
                .isInstanceOf(BaseException.class).hasMessage("sms.send.too.frequent");
            redis.when(() -> RedisUtil.reserveAttempt(anyString(), anyInt(), anyLong())).thenReturn(true);
            assertThatThrownBy(() -> service.sendSmsCode(params("2"), request()))
                .isInstanceOf(BaseException.class).hasMessage("captcha.sms.repeat.send");
        }
        verifyNoInteractions(sender);
        verify(records, never()).save(any());
    }

    @Test
    void rejectsInvalidDecryptedPhoneBeforeReservingQuota() throws Exception {
        CaptchaService service = service(mock(AliyunSmsService.class), mock(SafeAccountMsgService.class));
        try (var redis = mockStatic(RedisUtil.class)) {
            for (String phone : java.util.List.of("", "1380000000", "138000000000", "abc", "12800000000")) {
                assertThatThrownBy(() -> service.sendSmsCode(params("2", phone), request()))
                    .isInstanceOf(BaseException.class).hasMessage("phone.format.invalid");
            }
            redis.verifyNoInteractions();
        }
    }
}
