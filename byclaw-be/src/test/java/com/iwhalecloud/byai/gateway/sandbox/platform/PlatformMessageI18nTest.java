package com.iwhalecloud.byai.gateway.sandbox.platform;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.gateway.sandbox.controller.SandboxController;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxResizeService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import java.util.Locale;
import java.util.Map;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.mock.env.MockEnvironment;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

class PlatformMessageI18nTest extends I18nTestSupport {
    @ParameterizedTest
    @CsvSource(value = {
        "zh-CN|平台响应无效|平台操作失败|平台请求失败，HTTP 503",
        "en-US|Invalid platform response|Platform operation failed|Platform request failed, HTTP 503"
    }, delimiter = '|')
    void gatewayFailuresUseTheRequestLocaleWithoutReplacingUpstreamMessages(
        String language, String invalid, String failed, String unavailable) {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        MockEnvironment environment = new MockEnvironment();
        @SuppressWarnings("unchecked")
        ObjectProvider<PlatformControlClient> clients = mock(ObjectProvider.class);
        var gateway = new PlatformRemoteGateway(new PlatformBackgroundExecution(environment), clients,
            new ObjectMapper(), environment);
        assertThatThrownBy(() -> gateway.data(null)).isInstanceOf(BdpRuntimeException.class).hasMessage(invalid);
        assertThatThrownBy(() -> gateway.data(Map.of("code", -1)))
            .isInstanceOf(BdpRuntimeException.class).hasMessage(failed);
        assertThatThrownBy(() -> gateway.data(Map.of("code", -1, "msg", "upstream detail")))
            .hasMessage("upstream detail");
        var httpError = mock(feign.FeignException.class);
        when(httpError.status()).thenReturn(503);
        assertThatThrownBy(() -> gateway.safe(() -> { throw httpError; }))
            .isInstanceOf(BdpRuntimeException.class).hasMessage(unavailable);
    }

    @ParameterizedTest
    @CsvSource(value = {
        "zh-CN|沙箱扩缩容处理失败: detail|沙箱扩缩容告警处理失败: detail",
        "en-US|Sandbox resize failed: detail|Sandbox autoscaling alert processing failed: detail"
    }, delimiter = '|')
    void resizeErrorsPreserveFailureStatusAndInterpolateDetails(String language, String resize, String alert) {
        LocaleContextHolder.setLocale(Locale.forLanguageTag(language));
        var controller = new SandboxController();
        var remote = mock(PlatformRemoteGateway.class);
        when(remote.isRemote()).thenReturn(true);
        when(remote.controller("resize", Map.of())).thenReturn(ResponseUtil.fail("detail"));
        ReflectionTestUtils.setField(controller, "platformRemote", remote);
        assertThat(controller.resizeSandbox(Map.of()).getMsg()).isEqualTo(resize);

        var service = mock(SandboxResizeService.class);
        when(service.handlePrometheusAlert(Map.of())).thenThrow(new IllegalStateException("detail"));
        ReflectionTestUtils.setField(controller, "sandboxResizeService", service);
        ReflectionTestUtils.setField(controller, "platformBackgroundExecution",
            new PlatformBackgroundExecution(new MockEnvironment()));
        var response = new MockHttpServletResponse();
        assertThat(controller.handleAutoscaleAlert(Map.of(), response, null).getMsg()).isEqualTo(alert);
        assertThat(response.getStatus()).isEqualTo(503);
    }
}
