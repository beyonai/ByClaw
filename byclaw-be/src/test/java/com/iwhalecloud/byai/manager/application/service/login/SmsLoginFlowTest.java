package com.iwhalecloud.byai.manager.application.service.login;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.config.SmsRateLimitConfig;
import com.iwhalecloud.byai.manager.infrastructure.sms.AliyunSmsService;
import com.iwhalecloud.byai.manager.mapper.login.SafeAccountMsgMapper;
import com.iwhalecloud.byai.manager.security.login.phone.PhoneAuthentication;
import com.iwhalecloud.byai.manager.security.login.phone.PhoneAuthenticationProvider;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
import org.junit.jupiter.api.Test;
import org.springframework.beans.BeanUtils;
import org.springframework.security.authentication.BadCredentialsException;
import org.springframework.test.util.ReflectionTestUtils;
import java.util.Date;
import java.util.List;
import java.util.concurrent.atomic.AtomicReference;
import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

/** Real send/record/authentication services with external persistence and SMS boundaries stubbed. */
class SmsLoginFlowTest extends LoginMessageSourceTestSupport {
    @Test
    void sentCodeIsActivatedAuthenticatesAndCannotBeReused() throws Exception {
        Fixture f = new Fixture();
        try (var redis = mockStatic(RedisUtil.class)) {
            CaptchaServiceTest.allowRedis(redis);
            assertThat(f.captcha.sendSmsCode(CaptchaServiceTest.params("1"), CaptchaServiceTest.request())).isTrue();
        }
        assertThat(f.persisted.get().getState()).isEqualTo("1");
        assertThat(f.provider.authenticate(f.credentials()).isAuthenticated()).isTrue();
        assertThat(f.persisted.get().getState()).isEqualTo("3");
        assertThatThrownBy(() -> f.provider.authenticate(f.credentials())).isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void zeroRowActivationCannotReportSuccessOrAuthenticate() throws Exception {
        Fixture f = new Fixture();
        when(f.mapper.updateById(any(SafeAccountMsg.class))).thenReturn(0);
        try (var redis = mockStatic(RedisUtil.class)) {
            CaptchaServiceTest.allowRedis(redis);
            assertThatThrownBy(() -> f.captcha.sendSmsCode(CaptchaServiceTest.params("1"), CaptchaServiceTest.request()))
                .isInstanceOf(IllegalStateException.class);
        }
        assertThat(f.persisted.get().getState()).isEqualTo("2");
        assertThatThrownBy(() -> f.provider.authenticate(f.credentials())).isInstanceOf(BadCredentialsException.class);
    }

    @Test
    void zeroRowInsertPreventsDelivery() throws Exception {
        Fixture f = new Fixture();
        when(f.mapper.insert(any(SafeAccountMsg.class))).thenReturn(0);
        try (var redis = mockStatic(RedisUtil.class)) {
            CaptchaServiceTest.allowRedis(redis);
            assertThatThrownBy(() -> f.captcha.sendSmsCode(CaptchaServiceTest.params("1"), CaptchaServiceTest.request()))
                .isInstanceOf(IllegalStateException.class);
        }
        assertThat(f.deliveredCode.get()).isNull();
    }

    private static class Fixture {
        final SafeAccountMsgMapper mapper = mock(SafeAccountMsgMapper.class);
        final AtomicReference<SafeAccountMsg> persisted = new AtomicReference<>();
        final AtomicReference<String> deliveredCode = new AtomicReference<>();
        final CaptchaService captcha = new CaptchaService();
        final PhoneAuthenticationProvider provider = new PhoneAuthenticationProvider();

        Fixture() {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), "sms-test"), SafeAccountMsg.class);
            SafeAccountMsgService records = new SafeAccountMsgService();
            ReflectionTestUtils.setField(records, "safeAccountMsgMapper", mapper);
            when(mapper.insert(any(SafeAccountMsg.class))).thenAnswer(i -> store(i.getArgument(0)));
            when(mapper.updateById(any(SafeAccountMsg.class))).thenAnswer(i -> store(i.getArgument(0)));
            when(mapper.selectList(any())).thenAnswer(i -> {
                LambdaQueryWrapper<SafeAccountMsg> query = i.getArgument(0);
                String sql = query.getSqlSegment();
                if (!sql.contains("state")) return List.of(); // initial cooldown query
                assertThat(query.getParamNameValuePairs().values()).contains("13800000000", "1");
                assertThat(sql).contains("state =", "expire_date >=");
                SafeAccountMsg row = persisted.get();
                if (row == null || !"1".equals(row.getState()) || row.getExpireDate().before(new Date())) return List.of();
                SafeAccountMsg copy = new SafeAccountMsg();
                BeanUtils.copyProperties(row, copy);
                return List.of(copy);
            });
            AliyunSmsService sender = mock(AliyunSmsService.class);
            when(sender.sendSms(eq("13800000000"), anyString(), eq("login"))).thenAnswer(i -> {
                assertThat(persisted.get().getState()).isEqualTo("2");
                deliveredCode.set(i.getArgument(1));
                return true;
            });
            SequenceService sequence = mock(SequenceService.class);
            when(sequence.nextVal()).thenReturn(101L);
            ReflectionTestUtils.setField(captcha, "smsService", sender);
            ReflectionTestUtils.setField(captcha, "safeAccountMsgService", records);
            ReflectionTestUtils.setField(captcha, "SequenceService", sequence);
            ReflectionTestUtils.setField(captcha, "smsRateLimitConfig", new SmsRateLimitConfig());
            UserService users = mock(UserService.class);
            when(users.findByUserPhone("13800000000")).thenReturn(new Users());
            ReflectionTestUtils.setField(provider, "userService", users);
            ReflectionTestUtils.setField(provider, "safeAccountMsgService", records);
            ReflectionTestUtils.setField(provider, "loginApplicationService", mock(LoginApplicationService.class));
        }

        int store(SafeAccountMsg row) {
            SafeAccountMsg copy = new SafeAccountMsg();
            BeanUtils.copyProperties(row, copy);
            persisted.set(copy);
            return 1;
        }

        PhoneAuthentication credentials() {
            PhoneAuthentication credentials = new PhoneAuthentication();
            credentials.setPhone("13800000000");
            credentials.setVerifyCode(deliveredCode.get());
            return credentials;
        }
    }
}
