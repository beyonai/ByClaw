package com.iwhalecloud.byai.state.common.filter;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatCode;

import com.iwhalecloud.byai.common.config.SignAntiReplayConfig;
import com.iwhalecloud.byai.state.common.filter.request.RequestWrapper;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

class SignAntiReplayFilterTest {

    @Test
    void verifiesPutJsonBodyWithTheSameIntegrityContractAsPost() throws Exception {
        SignAntiReplayFilter filter = new SignAntiReplayFilter();
        SignAntiReplayConfig config = new SignAntiReplayConfig();
        config.setSalt("test-salt");
        ReflectionTestUtils.setField(filter, "signProperties", config);
        String body = "{\"enabled\":false}";
        String nonce = "nonce";
        long timestamp = 1_700_000_000_000L;
        MockHttpServletRequest rawRequest = new MockHttpServletRequest("PUT", "/connector/mcp-services/9/enabled");
        rawRequest.setContentType(MediaType.APPLICATION_JSON_VALUE);
        rawRequest.setCharacterEncoding("UTF-8");
        rawRequest.setContent(body.getBytes(java.nio.charset.StandardCharsets.UTF_8));
        rawRequest.getSession().setAttribute("USER_CODE", "42");
        RequestWrapper request = new RequestWrapper(rawRequest);
        String signature = filter.getSignature("42", nonce, timestamp, body);

        assertThatCode(() -> ReflectionTestUtils.invokeMethod(
            filter, "checkSignature", request, signature, nonce, String.valueOf(timestamp)))
            .doesNotThrowAnyException();
    }

    @Test
    void letsSkillMarketplaceEndpointUseBeyondTokenWithoutCommonRequestSignature() throws Exception {
        SignAntiReplayFilter filter = new SignAntiReplayFilter();
        SignAntiReplayConfig config = new SignAntiReplayConfig();
        config.setEnabled(true);
        ReflectionTestUtils.setField(filter, "signProperties", config);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/tool/installThirdPartySkill");
        request.setServletPath("/tool/installThirdPartySkill");
        MockHttpServletResponse response = new MockHttpServletResponse();
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, response, filterChain);

        assertThat(filterChain.getRequest()).isSameAs(request);
    }

    @Test
    void letsConnectorSkillCallbackUseBeyondTokenWithoutCommonRequestSignature() throws Exception {
        SignAntiReplayFilter filter = new SignAntiReplayFilter();
        SignAntiReplayConfig config = new SignAntiReplayConfig();
        config.setEnabled(true);
        ReflectionTestUtils.setField(filter, "signProperties", config);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/connector/authorization/skill-complete");
        request.setServletPath("/connector/authorization/skill-complete");
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), filterChain);

        assertThat(filterChain.getRequest()).isSameAs(request);
    }

    @Test
    void letsOrchestratorRuntimeUseBeyondTokenWithoutCommonRequestSignature() throws Exception {
        SignAntiReplayFilter filter = new SignAntiReplayFilter();
        SignAntiReplayConfig config = new SignAntiReplayConfig();
        config.setEnabled(true);
        ReflectionTestUtils.setField(filter, "signProperties", config);
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/internal/v1/orchestrators/resolve-runtime");
        request.setServletPath("/internal/v1/orchestrators/resolve-runtime");
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), filterChain);

        assertThat(filterChain.getRequest()).isSameAs(request);
    }
}
