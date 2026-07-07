package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.util.DigEmployeeRedisKeys;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class DigitalEmployeeRedisConfigSyncTest {

    private DigitalEmployeeApplicationService service;

    private DigEmployeeRedisSyncProperties digEmployeeRedisSyncProperties;

    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    private StringRedisTemplate stringRedisTemplate;

    private ValueOperations<String, String> valueOperations;

    @BeforeEach
    void setUp() {
        service = new DigitalEmployeeApplicationService();
        digEmployeeRedisSyncProperties = new DigEmployeeRedisSyncProperties();
        digEmployeeRedisSyncProperties.setJsonRedisSyncEnabled(true);
        ReflectionTestUtils.setField(service, "digEmployeeRedisSyncProperties", digEmployeeRedisSyncProperties);

        ssResExtDigEmployeeService = mock(SsResExtDigEmployeeService.class);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", ssResExtDigEmployeeService);

        stringRedisTemplate = mock(StringRedisTemplate.class);
        @SuppressWarnings("unchecked")
        ValueOperations<String, String> ops = mock(ValueOperations.class);
        valueOperations = ops;
        when(stringRedisTemplate.opsForValue()).thenReturn(valueOperations);

        RedisUtil redisUtil = new RedisUtil();
        ReflectionTestUtils.setField(redisUtil, "stringRedisTemplate", stringRedisTemplate);
        ReflectionTestUtils.setField(RedisUtil.class, "instance", redisUtil);
    }

    @AfterEach
    void tearDown() {
        ReflectionTestUtils.setField(RedisUtil.class, "instance", null);
    }

    @Test
    void syncDigEmployeeConfigJsonToRedis_writesFullJsonSnapshot() {
        String json = "{\"resourceId\":\"10000005\"}";

        ReflectionTestUtils.invokeMethod(service, "syncDigEmployeeConfigJsonToRedis", 10000005L, json);

        verify(valueOperations).set(DigEmployeeRedisKeys.configJsonKey(10000005L), json);
    }

    @Test
    void syncDigEmployeeConfigJsonToRedis_skipsWhenDisabled() {
        digEmployeeRedisSyncProperties.setJsonRedisSyncEnabled(false);

        ReflectionTestUtils.invokeMethod(service, "syncDigEmployeeConfigJsonToRedis", 10000005L, "{}");

        verify(valueOperations, never()).set(org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.anyString());
    }

    @Test
    void removeDigEmployeeConfigJsonFromRedis_deletesConfigKey() {
        ReflectionTestUtils.invokeMethod(service, "removeDigEmployeeConfigJsonFromRedis", 10000005L);

        verify(stringRedisTemplate).delete(DigEmployeeRedisKeys.configJsonKey(10000005L));
    }

    @Test
    void syncResourceConfigJsonToRedis_writesRelatedResourceSnapshot() {
        String json = "{\"resourceId\":\"1111\"}";

        ReflectionTestUtils.invokeMethod(service, "syncResourceConfigJsonToRedis", "AGENT", 1111L, json);

        verify(valueOperations).set(DigEmployeeRedisKeys.resourceConfigJsonKey("AGENT", 1111L), json);
    }

    @Test
    void syncExistingDigEmployeeConfigToRedis_prefersTargetContent() {
        String json = "{\"resourceId\":\"10000005\"}";
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setTargetContent(json);
        when(ssResExtDigEmployeeService.findById(10000005L)).thenReturn(ext);

        service.syncExistingDigEmployeeConfigToRedisQuietly(10000005L);

        verify(valueOperations).set(DigEmployeeRedisKeys.configJsonKey(10000005L), json);
    }

    @Test
    void resolveDigEmployeeJsonForRedisSync_returnsTargetContent() {
        String json = "{\"resourceId\":\"9\"}";
        SsResExtDigEmployee ext = new SsResExtDigEmployee();
        ext.setTargetContent(json);
        when(ssResExtDigEmployeeService.findById(9L)).thenReturn(ext);

        String resolved = (String) ReflectionTestUtils.invokeMethod(service, "resolveDigEmployeeJsonForRedisSync", 9L);

        assertThat(resolved).isEqualTo(json);
    }
}
