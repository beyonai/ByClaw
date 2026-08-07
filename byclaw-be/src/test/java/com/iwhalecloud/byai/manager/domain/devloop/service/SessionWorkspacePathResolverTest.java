package com.iwhalecloud.byai.manager.domain.devloop.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.mockito.junit.jupiter.MockitoSettings;
import org.mockito.quality.Strictness;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.application.service.user.UserBucketNamingService;

/**
 * 会话工作区路径解析。核心约定:{nfs根}/{bucket}/by/.sessions/{key},与沙箱里 /by/.sessions/{key}/ 同一份 NFS 数据。
 * 集成测试 backend 直跑依赖它把用例落进用户桶,曾写死 /tmp 导致与数字员工目录分叉。
 */
@ExtendWith(MockitoExtension.class)
@MockitoSettings(strictness = Strictness.LENIENT)
class SessionWorkspacePathResolverTest {

    @Mock
    private LoginApplicationService loginApplicationService;

    @Mock
    private UserBucketNamingService userBucketNamingService;

    @InjectMocks
    private SessionWorkspacePathResolver resolver;

    @BeforeEach
    void setUp() {
        ReflectionTestUtils.setField(resolver, "fileStorageRoot", "/data/byclaw-storage");
        LoginInfo owner = new LoginInfo();
        owner.setUserCode("u1");
        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(owner);
        when(userBucketNamingService.buildUserBucketName("u1")).thenReturn("byclaw-u1");
    }

    @Test
    @DisplayName("会话目录 = {nfs根}/{bucket}/by/.sessions/{sessionId}")
    void resolvesSessionDir() {
        assertThat(resolver.resolveSessionDir(7L, 123L)).isEqualTo("/data/byclaw-storage/byclaw-u1/by/.sessions/123");
    }

    @Test
    @DisplayName("桶根 = {nfs根}/{bucket},供执行机探 NFS 挂载")
    void resolvesBucketDir() {
        assertThat(resolver.resolveBucketDir(7L)).isEqualTo("/data/byclaw-storage/byclaw-u1");
    }

    @Test
    @DisplayName("桶名解析不出时桶根为 null,调用方跳过挂载校验而不是拦死执行")
    void bucketDirNullWhenUnresolvable() {
        assertThat(resolver.resolveBucketDir(null)).isNull();

        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(null);
        assertThat(resolver.resolveBucketDir(7L)).isNull();
    }

    @Test
    @DisplayName("仓库目录在会话目录下再拼 repoName")
    void resolvesRepoDir() {
        assertThat(resolver.resolveRepoDir(7L, 123L, "app"))
            .isEqualTo("/data/byclaw-storage/byclaw-u1/by/.sessions/123/app");
    }

    @Test
    @DisplayName("非数字会话键(run 独占目录)同样落在 .sessions 下")
    void resolvesNonNumericSessionKey() {
        assertThat(resolver.resolveSessionDir(7L, "integration-run-9"))
            .isEqualTo("/data/byclaw-storage/byclaw-u1/by/.sessions/integration-run-9");
    }

    @Test
    @DisplayName("根路径带多余斜杠时不产生连续分隔符")
    void normalizesRedundantSlashes() {
        ReflectionTestUtils.setField(resolver, "fileStorageRoot", "/data/byclaw-storage/");
        assertThat(resolver.resolveSessionDir(7L, 123L)).isEqualTo("/data/byclaw-storage/byclaw-u1/by/.sessions/123");
    }

    @Test
    @DisplayName("repoName 为空时退化为会话目录，不拼出尾随斜杠")
    void blankRepoNameFallsBackToSessionDir() {
        assertThat(resolver.resolveRepoDir(7L, 123L, " ")).isEqualTo("/data/byclaw-storage/byclaw-u1/by/.sessions/123");
    }

    @Test
    @DisplayName("用户或会话键缺失、桶名解析不出时返回 null，调用方自行兜底")
    void returnsNullWhenUnresolvable() {
        assertThat(resolver.resolveSessionDir(null, 123L)).isNull();
        assertThat(resolver.resolveSessionDir(7L, null)).isNull();

        LoginInfo blank = new LoginInfo();
        blank.setUserCode("  ");
        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(blank);
        assertThat(resolver.resolveSessionDir(7L, 123L)).isNull();

        when(loginApplicationService.getLoginInfo(anyLong())).thenReturn(null);
        assertThat(resolver.resolveSessionDir(7L, 123L)).isNull();
    }

    @Test
    @DisplayName("解析异常收敛为 null，不把异常抛给集成测试执行流")
    void swallowsResolveFailure() {
        when(loginApplicationService.getLoginInfo(anyLong())).thenThrow(new IllegalStateException("boom"));
        assertThat(resolver.resolveSessionDir(7L, 123L)).isNull();
    }
}
