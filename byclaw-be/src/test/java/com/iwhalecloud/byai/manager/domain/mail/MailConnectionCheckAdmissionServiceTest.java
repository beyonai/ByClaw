package com.iwhalecloud.byai.manager.domain.mail;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;

class MailConnectionCheckAdmissionServiceTest {

    @Test
    @SuppressWarnings("unchecked")
    void nodeSaturationRejectsAnotherUserUntilPermitIsReleased() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(),
            anyString(), anyString(), anyString())).thenReturn(1L);
        MailConnectionCheckAdmissionService service = new MailConnectionCheckAdmissionService(redis, 1, 2_000L);

        MailConnectionCheckAdmissionService.Admission first = service.acquire(1001L);
        assertThatThrownBy(() -> service.acquire(1002L))
            .isInstanceOf(MailConnectionCheckAdmissionService.BusyException.class);
        first.close();
        service.acquire(1002L).close();
    }

    @Test
    @SuppressWarnings("unchecked")
    void perUserCrossNodeLeaseAndCooldownRejectManyAccountChecks() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(),
            anyString(), anyString(), anyString())).thenReturn(0L).thenReturn(1L);
        MailConnectionCheckAdmissionService service = new MailConnectionCheckAdmissionService(redis, 4, 2_000L);

        assertThatThrownBy(() -> service.acquire(1001L))
            .isInstanceOf(MailConnectionCheckAdmissionService.BusyException.class);
        service.acquire(1002L);
    }

    @Test
    @SuppressWarnings("unchecked")
    void ownerMustStillHoldUserLeaseBeforePersistence() {
        StringRedisTemplate redis = mock(StringRedisTemplate.class);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(),
            anyString(), anyString(), anyString())).thenReturn(1L);
        when(redis.execute(any(org.springframework.data.redis.core.script.RedisScript.class), any(),
            anyString(), anyString())).thenReturn(0L);
        MailConnectionCheckAdmissionService service = new MailConnectionCheckAdmissionService(redis, 2, 2_000L);
        MailConnectionCheckAdmissionService.Admission admission = service.acquire(1001L);

        assertThatThrownBy(admission::assertOwnedAndRenew)
            .isInstanceOf(MailConnectionCheckAdmissionService.LeaseLostException.class);
        admission.close();
    }
}
