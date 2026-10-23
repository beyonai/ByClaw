package com.iwhalecloud.byai.gateway.sandbox.service;

import com.iwhalecloud.byai.common.feign.response.SandboxResponse;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.MockedStatic;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Date;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 释放失败必须保留待核对状态，不能清理成功释放后的缓存或标记完成。
 * @author Codex
 * @since 2026-10-23
 */
class SandboxReleaseOutcomeTest extends I18nTestSupport {
    private SandboxService service;
    private SsSandboxRecordMapper records;
    private SandboxLifecycleFacade runtime;
    private SandboxMetadataCache metadata;
    private SsSandboxRecord record;

    /** 仅使用存储与执行服务替身，不连接 Redis 或运行环境。 */
    @BeforeEach
    void prepare() {
        service = new SandboxService();
        records = mock(SsSandboxRecordMapper.class);
        runtime = mock(SandboxLifecycleFacade.class);
        metadata = mock(SandboxMetadataCache.class);
        ReflectionTestUtils.setField(service, "sandboxRecordMapper", records);
        ReflectionTestUtils.setField(service, "sandboxLifecycleFacade", runtime);
        ReflectionTestUtils.setField(service, "sandboxMetadataCache", metadata);
        record = new SsSandboxRecord();
        record.setId(9L);
        record.setUserCode("owner");
        record.setOwnerScope("USER");
        record.setSandboxId("runtime-9");
        record.setSandboxType("openclaw");
        record.setResourceId(-1L);
        record.setStatus("RUNNING");
        record.setLockVersion(1);
        record.setVersion(1);
        when(records.selectById(9L)).thenReturn(record);
        when(records.markReleasing(eq(9L), any(), any(Date.class), eq(1))).thenReturn(1);
    }

    /** 拒绝、空响应和异常均不能转成已释放；只有明确拒绝能确定失败。 */
    @ParameterizedTest
    @ValueSource(strings = {"rejected", "empty", "exception"})
    void failedReleaseKeepsPendingStateAndCachedIdentity(String outcome) {
        if ("rejected".equals(outcome)) {
            when(runtime.removeSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.error("test rejection"));
        } else if ("exception".equals(outcome)) {
            when(runtime.removeSandbox(any(SandboxInfo.class))).thenThrow(new IllegalStateException("timeout"));
        }
        try (MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class)) {
            assertThatThrownBy(() -> service.removeSandboxById(9L))
                .isInstanceOfSatisfying(SandboxReleaseException.class,
                    failure -> assertThat(failure.isOutcomeUnknown()).isEqualTo(!"rejected".equals(outcome)));
            verify(runtime).removeSandbox(any(SandboxInfo.class));
            verify(records, never()).updateStatusToReleased(any(), any(), any(), any());
            verifyNoInteractions(metadata);
            assertThat(record.getStatus()).isEqualTo("RELEASING");
            redis.verify(() -> RedisUtil.del(anyString()));
        }
    }

    /** 远端确认成功才尝试完成条件更新，版本使用释放中的新版本。 */
    @Test
    void confirmedReleaseAttemptsCompletionWithConsumedVersion() {
        when(runtime.removeSandbox(any(SandboxInfo.class))).thenReturn(SandboxResponse.success(null));
        try (MockedStatic<RedisUtil> redis = mockStatic(RedisUtil.class)) {
            service.removeSandboxById(9L);
            verify(records).updateStatusToReleased(eq(9L), any(), any(Date.class), eq(2));
            redis.verify(() -> RedisUtil.del(anyString()));
        }
    }
}
