package com.iwhalecloud.byai.manager.interfaces.controller.adminconsole;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.gateway.sandbox.platform.PlatformRemoteGateway;
import com.iwhalecloud.byai.manager.dto.adminconsole.LogSearchReq;
import java.util.Map;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertSame;
import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.Mockito.any;
import static org.mockito.Mockito.anyString;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/**
 * 日志查询接口回归测试。
 *
 * @author Codex
 * @date 2026-11-12
 */
class LogCenterControllerTest {
    private final PlatformRemoteGateway platformRemoteGateway = mock(PlatformRemoteGateway.class);

    private final LogCenterController logCenterController = new LogCenterController(platformRemoteGateway);

    /**
     * 清理当前线程登录身份。
     */
    @AfterEach
    void cleanup() {
        CurrentUserHolder.clearLoginInfo();
    }

    /**
     * 设置管理员登录身份。
     */
    private void setAdminLoginInfo() {
        ReflectionTestUtils.setField(logCenterController, "logRegion", "cn-hangzhou");
        ReflectionTestUtils.setField(logCenterController, "logProject", "test-project");
        ReflectionTestUtils.setField(logCenterController, "logstore", "test-store");
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("adminvip");
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    /**
     * 创建有效日志查询条件。
     *
     * @return 日志查询条件
     */
    private LogSearchReq createLogSearchReq() {
        LogSearchReq logSearchReq = new LogSearchReq();
        logSearchReq.setFrom(1000L);
        logSearchReq.setTo(2000L);
        logSearchReq.setPageToken("opaque-page-token");
        logSearchReq.setModuleCode("byclaw-be");
        logSearchReq.setInstanceID("instance-1");
        return logSearchReq;
    }

    /**
     * 校验未授权查询不会访问平台。
     */
    @Test
    void unauthorizedRequestsNeverReachPlatform() {
        assertEquals(CommonErrorCode.ERROR_CODE_50500, assertThrows(BaseException.class,
            () -> logCenterController.search(createLogSearchReq())).getErrorCode());
        verifyNoInteractions(platformRemoteGateway);
    }

    /**
     * 校验日志查询的访问控制和平台调用契约。
     */
    @Test
    void forwardsOriginalQueryAndOpaquePageTokenThroughPlatformBridge() {
        setAdminLoginInfo();
        when(platformRemoteGateway.isRemote()).thenReturn(true);
        LogSearchReq logSearchReq = createLogSearchReq();
        Map<String, Object> logSearchResult = Map.of("complete", false, "nextPageToken", "retry-token");
        when(platformRemoteGateway.call("logs", "search", logSearchReq)).thenReturn(logSearchResult);
        assertSame(logSearchResult, logCenterController.search(logSearchReq).getData());
        assertEquals("cn-hangzhou", logSearchReq.getRegion());
        assertEquals("test-project", logSearchReq.getProject());
        assertEquals("test-store", logSearchReq.getLogstore());
        assertEquals("byclaw-be", logSearchReq.getModuleCode());
        assertEquals("instance-1", logSearchReq.getInstanceID());
        verify(platformRemoteGateway).call("logs", "search", logSearchReq);
    }

    /**
     * 校验日志查询的访问控制和平台调用契约。
     */
    @Test
    void invalidWindowAndPageSizeNeverReachPlatform() {
        setAdminLoginInfo();
        LogSearchReq logSearchReq = createLogSearchReq();
        logSearchReq.setTo(logSearchReq.getFrom() + 86401);
        assertThrows(BaseException.class, () -> logCenterController.search(logSearchReq));
        logSearchReq.setTo(2000L);
        logSearchReq.setPageSize(201);
        assertThrows(BaseException.class, () -> logCenterController.search(logSearchReq));
        verifyNoInteractions(platformRemoteGateway);
    }

    /**
     * 校验日志查询的访问控制和平台调用契约。
     */
    @Test
    void legacyModeReturnsConfigurationErrorWithoutRemoteCall() {
        setAdminLoginInfo();
        assertEquals(-1, logCenterController.search(createLogSearchReq()).getCode());
        verify(platformRemoteGateway, never()).call(anyString(), anyString(), any());
    }

    /**
     * 默认日志源缺失时拒绝调用平台。
     */
    @Test
    void missingDefaultSourceNeverReachesPlatform() {
        setAdminLoginInfo();
        when(platformRemoteGateway.isRemote()).thenReturn(true);
        ReflectionTestUtils.setField(logCenterController, "logProject", "");
        assertThrows(BaseException.class, () -> logCenterController.search(createLogSearchReq()));
        verify(platformRemoteGateway, never()).call(anyString(), anyString(), any());
    }
}
