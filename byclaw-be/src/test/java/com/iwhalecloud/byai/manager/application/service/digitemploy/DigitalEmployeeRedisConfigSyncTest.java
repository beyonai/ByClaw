package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson2.JSONObject;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.util.DigEmployeeRedisKeys;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.spy;
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
        ReflectionTestUtils.setField(service, "digitalEmployeeGroupApplicationService",
            mock(DigitalEmployeeGroupApplicationService.class));

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

    @Test
    void synOpenClawWorkSpace_persistsAndCachesTheSameSubmittedImageModelId() {
        DigitalEmployeeApplicationService syncingService = spy(service);
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setResourceId(9L);
        doReturn(details).when(syncingService).findDetailsById(any());

        SsResExtDigEmployee persistedEntity = new SsResExtDigEmployee();
        persistedEntity.setResourceId(9L);
        when(ssResExtDigEmployeeService.findById(9L)).thenReturn(persistedEntity);

        SsResourceService ssResourceService = mock(SsResourceService.class);
        ReflectionTestUtils.setField(syncingService, "ssResourceService", ssResourceService);
        SsResourceRelDetailService ssResourceRelDetailService = mock(SsResourceRelDetailService.class);
        when(ssResourceRelDetailService.findByResourceId(9L)).thenReturn(java.util.List.of());
        ReflectionTestUtils.setField(syncingService, "ssResourceRelDetailService", ssResourceRelDetailService);
        ReflectionTestUtils.setField(syncingService, "resourceArtifactStorageService",
            mock(ResourceArtifactStorageService.class));
        ReflectionTestUtils.setField(syncingService, "ssResourceArtifactService", mock(SsResourceArtifactService.class));

        DigitalEmployeeDTO input = new DigitalEmployeeDTO();
        input.setImageModelId("9007199254740993");

        boolean synced = syncingService.synOpenClawWorkSpace(9L, input);

        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        verify(valueOperations).set(eq(DigEmployeeRedisKeys.configJsonKey(9L)), jsonCaptor.capture());
        verify(ssResExtDigEmployeeService).update(persistedEntity);
        JSONObject persistedJson = com.alibaba.fastjson2.JSON.parseObject(persistedEntity.getTargetContent());
        JSONObject redisJson = com.alibaba.fastjson2.JSON.parseObject(jsonCaptor.getValue());
        assertThat(synced).isTrue();
        assertThat(persistedJson.getString("imageModelId")).isEqualTo("9007199254740993");
        assertThat(redisJson.getString("imageModelId")).isEqualTo(persistedJson.getString("imageModelId"));
    }

    @org.junit.jupiter.params.ParameterizedTest
    @org.junit.jupiter.params.provider.ValueSource(booleans = {false, true})
    void publicationSyncReadsUncommittedVersionAndRollsBackArtifactWithEmployee(boolean existing,
        @org.junit.jupiter.api.io.TempDir java.nio.file.Path directory) {
        var dataSource = new org.apache.ibatis.datasource.unpooled.UnpooledDataSource("org.sqlite.JDBC",
            "jdbc:sqlite:" + directory.resolve("sync.sqlite"), null, null);
        var jdbc = new org.springframework.jdbc.core.JdbcTemplate(dataSource);
        jdbc.execute("CREATE TABLE employee (id BIGINT PRIMARY KEY, name TEXT)");
        jdbc.execute("CREATE TABLE artifact (resource_id BIGINT, path TEXT)");
        if (existing) jdbc.update("INSERT INTO employee VALUES (9, '旧版本')");
        var manager = new org.springframework.jdbc.datasource.DataSourceTransactionManager(dataSource);
        var advice = new com.iwhalecloud.byai.common.config.TransactionAdviceConfig();
        ReflectionTestUtils.setField(advice, "transactionManager", manager);
        var syncingService = spy(service);
        org.mockito.Mockito.doAnswer(call -> jdbc.queryForObject("SELECT name FROM employee WHERE id=9", (rs, n) -> {
            var details = new DigitalEmployeeDetailsDTO(); details.setResourceId(9L);
            details.setResourceName(rs.getString(1)); return details;
        })).when(syncingService).findDetailsById(any());
        var extension = new SsResExtDigEmployee(); extension.setResourceId(9L);
        when(ssResExtDigEmployeeService.findById(9L)).thenReturn(extension);
        ReflectionTestUtils.setField(syncingService, "ssResourceService", mock(SsResourceService.class));
        ReflectionTestUtils.setField(syncingService, "ssResourceRelDetailService", mock(SsResourceRelDetailService.class));
        var storage = mock(ResourceArtifactStorageService.class);
        ReflectionTestUtils.setField(syncingService, "resourceArtifactStorageService", storage);
        var artifactMapper = mock(com.iwhalecloud.byai.manager.mapper.resource.SsResourceArtifactMapper.class);
        when(artifactMapper.insert(any(com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact.class)))
            .thenAnswer(call -> {
                com.iwhalecloud.byai.manager.entity.resource.SsResourceArtifact artifact = call.getArgument(0);
                return jdbc.update("INSERT INTO artifact VALUES (?,?)", artifact.getResourceId(), artifact.getArtifactPath());
            });
        var artifacts = new SsResourceArtifactService();
        ReflectionTestUtils.setField(artifacts, "ssResourceArtifactMapper", artifactMapper);
        ReflectionTestUtils.setField(artifacts, "sequenceService", mock(com.iwhalecloud.byai.state.domain.sys.service.SequenceService.class));
        ReflectionTestUtils.setField(artifacts, "resourceArtifactPathResolver",
            new com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactPathResolver());
        var artifactFactory = new org.springframework.aop.framework.ProxyFactory(artifacts);
        artifactFactory.addAdvice(advice.getAdvisor());
        ReflectionTestUtils.setField(syncingService, "ssResourceArtifactService", artifactFactory.getProxy());
        var factory = new org.springframework.aop.framework.ProxyFactory(syncingService);
        factory.addAdvice(advice.getAdvisor());
        var proxied = (DigitalEmployeeApplicationService) factory.getProxy();
        new org.springframework.transaction.support.TransactionTemplate(manager).executeWithoutResult(status -> {
            if (existing) jdbc.update("UPDATE employee SET name='本次待发布版本' WHERE id=9");
            else jdbc.update("INSERT INTO employee VALUES (9, '本次待发布版本')");
            assertThat(proxied.syncPublicationOpenClawWorkSpace(9L, new DigitalEmployeeDTO())).isTrue();
            assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM artifact", Integer.class)).isEqualTo(1);
            status.setRollbackOnly();
        });
        var json = ArgumentCaptor.forClass(String.class);
        verify(storage).syncResourceJsonByBizType(json.capture(), eq("DIG_EMPLOYEE"), eq(9L));
        assertThat(JSONObject.parseObject(json.getValue()).getString("resourceName")).isEqualTo("本次待发布版本");
        verify(valueOperations).set(DigEmployeeRedisKeys.configJsonKey(9L), json.getValue());
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM artifact", Integer.class)).isZero();
        assertThat(jdbc.queryForObject("SELECT COUNT(*) FROM employee", Integer.class)).isEqualTo(existing ? 1 : 0);
        if (existing) assertThat(jdbc.queryForObject("SELECT name FROM employee WHERE id=9", String.class)).isEqualTo("旧版本");
    }
}
