package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.data.redis.core.StringRedisTemplate;

@ExtendWith(MockitoExtension.class)
class DigEmployeeChangeEventPublisherTest {

    private static final String CHANNEL = "byai:test:dig_employee_pub";

    @Mock
    private StringRedisTemplate stringRedisTemplate;

    @Mock
    private DigEmployeeChangeNotifyProperties properties;

    @Mock
    private DigEmployeeChangeAuthRefreshService digEmployeeChangeAuthRefreshService;

    @InjectMocks
    private DigEmployeeChangeEventPublisher publisher;

    @BeforeEach
    void setUp() {
        when(properties.isPublishEnabled()).thenReturn(true);
        when(properties.getPubsubChannel()).thenReturn(CHANNEL);
        when(properties.isAuthRefreshEnabled()).thenReturn(false);
    }

    @Test
    void publishAfterCommitOrNow_convertAndSend() {
        publisher.publishAfterCommitOrNow(DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, 42L);
        verify(stringRedisTemplate).convertAndSend(eq(CHANNEL), anyString());
    }
}
