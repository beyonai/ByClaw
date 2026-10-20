package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.*;
import static org.mockito.ArgumentMatchers.*;
import static org.mockito.Mockito.*;

import com.iwhalecloud.byai.common.config.TransactionAdviceConfig;
import com.iwhalecloud.byai.common.storage.ResourceFS;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.aop.framework.ProxyFactory;
import org.springframework.data.redis.core.StringRedisTemplate;
import org.springframework.data.redis.core.ValueOperations;
import org.springframework.jdbc.datasource.DataSourceTransactionManager;
import org.springframework.jdbc.datasource.DriverManagerDataSource;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.transaction.support.TransactionTemplate;

class ResourceJsonCacheServiceTest {
    StringRedisTemplate redis = mock(StringRedisTemplate.class);
    ValueOperations<String, String> values = mock(ValueOperations.class);
    ResourceJsonCacheService cache = new ResourceJsonCacheService(redis);
    TransactionTemplate transaction;
    ResourceArtifactStorageService storage;
    ResourceFS files = mock(ResourceFS.class);

    @BeforeEach void setup() {
        when(redis.opsForValue()).thenReturn(values);
        var manager = new DataSourceTransactionManager(new DriverManagerDataSource(
            "jdbc:h2:mem:" + UUID.randomUUID() + ";DB_CLOSE_DELAY=-1"));
        transaction = new TransactionTemplate(manager);
        var advice = new TransactionAdviceConfig();
        ReflectionTestUtils.setField(advice, "transactionManager", manager);
        var target = new ResourceArtifactStorageService();
        var paths = new ResourceArtifactPathResolver();
        ReflectionTestUtils.setField(target, "resourceFS", files);
        ReflectionTestUtils.setField(target, "resourceArtifactPathResolver", paths);
        ReflectionTestUtils.setField(target, "resourceJsonCacheService", cache);
        var proxy = new ProxyFactory(target);
        proxy.setProxyTargetClass(true);
        proxy.addAdvice(advice.getAdvisor());
        storage = (ResourceArtifactStorageService) proxy.getProxy();
        ReflectionTestUtils.setField(target, "ioDelegate", storage);
    }

    @Test void commercialAndLocalStandardJsonUseTheSameKeysAndOverwriteOnUpdate() {
        for (String type : new String[]{"SKILL", "KG_DOC", "KG_QA", "TOOL", "TOOLKIT", "MCP", "AGENT"}) {
            storage.publishResourceJson("{\"resourceId\":42,\"source\":\"synchronized\"}", type, 42);
            storage.uploadToSubdirectory("{\"resourceId\":42,\"source\":\"local\"}".getBytes(),
                type.startsWith("KG_") ? "doc" : type.toLowerCase(), type + "_42.json", "application/json");
            verify(values).set(type + "_42", "{\"resourceId\":42,\"source\":\"synchronized\"}");
            verify(values).set(type + "_42", "{\"resourceId\":42,\"source\":\"local\"}");
        }
    }

    @Test void suspendedFileIoDoesNotPublishRedisBeforeTheBusinessTransactionCommits() {
        transaction.executeWithoutResult(status -> {
            storage.publishResourceJson("{\"version\":2}", "SKILL", 42);
            verifyNoInteractions(values);
        });
        verify(values).set("SKILL_42", "{\"version\":2}");
        clearInvocations(values);
        transaction.executeWithoutResult(status -> {
            storage.publishResourceJson("{\"version\":3}", "SKILL", 42);
            status.setRollbackOnly();
        });
        verifyNoInteractions(values);
    }

    @Test void deletionWaitsForCommitAndRollbackPreservesTheCache() {
        transaction.executeWithoutResult(status -> {
            storage.deleteResourceJsonByBizType("SKILL", 42);
            verify(redis, never()).delete(anyString());
            status.setRollbackOnly();
        });
        verify(redis, never()).delete(anyString());
        transaction.executeWithoutResult(status -> storage.deleteResourceJsonByBizType("SKILL", 42));
        verify(redis).delete("SKILL_42");
    }

    @Test void unsupportedFilesAreIgnoredAndInvalidJsonEvictsOldValues() {
        cache.publishedFile("skill", "SKILL_42.zip", new byte[0]);
        cache.publishedFile("dig_employee", "DIG_EMPLOYEE_42.json", "{}".getBytes());
        cache.publishedFile("skill/untrusted-package", "SKILL_42.json", "{}".getBytes());
        cache.deletedFile("skill/untrusted-package/SKILL_42.json");
        verifyNoInteractions(values);
        verify(redis, never()).delete(anyString());
        cache.putAfterCommit("SKILL", 42, "malformed");
        verify(redis).delete("SKILL_42");
    }

    @Test void redisFailureAfterCommitDoesNotReportTheDatabaseSaveAsFailed() {
        doThrow(new IllegalStateException("Redis unavailable")).when(values).set(anyString(), anyString());
        assertThatCode(() -> transaction.executeWithoutResult(status ->
            storage.publishResourceJson("{}", "SKILL", 42))).doesNotThrowAnyException();
    }
}
