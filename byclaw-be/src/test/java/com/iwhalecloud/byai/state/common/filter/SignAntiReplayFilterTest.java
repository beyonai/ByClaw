package com.iwhalecloud.byai.state.common.filter;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.common.config.SignAntiReplayConfig;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockFilterChain;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpServletResponse;
import org.springframework.test.util.ReflectionTestUtils;

class SignAntiReplayFilterTest {

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
    void letsSkillMarketplaceManageableEmployeeQueryUseBeyondTokenWithoutCommonRequestSignature() throws Exception {
        SignAntiReplayFilter filter = new SignAntiReplayFilter();
        SignAntiReplayConfig config = new SignAntiReplayConfig();
        config.setEnabled(true);
        ReflectionTestUtils.setField(filter, "signProperties", config);
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/byaiService/tool/queryThirdPartySkillManageableDigitalEmployees");
        request.setServletPath("/tool/queryThirdPartySkillManageableDigitalEmployees");
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), filterChain);

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

    @Test
    void letsArtifactUploadUseBeyondTokenWithoutCommonRequestSignature() throws Exception {
        SignAntiReplayFilter filter = enabledFilter();
        MockHttpServletRequest request = new MockHttpServletRequest("POST",
            "/byaiService/open/api/v1/artifacts");
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), filterChain);

        assertThat(filterChain.getRequest()).isSameAs(request);
    }

    @Test
    void letsArtifactCapabilityUrlPassWithoutRequestSignature() throws Exception {
        SignAntiReplayFilter filter = enabledFilter();
        ReflectionTestUtils.setField(filter, "artifactPreviewPathPrefix", "/artifact-preview");
        ReflectionTestUtils.setField(filter, "artifactDownloadPathPrefix", "/artifact-download");
        MockHttpServletRequest request = new MockHttpServletRequest("GET",
            "/byaiService/artifact-preview/artifact/key/index.html");
        request.setContextPath("/byaiService");
        MockFilterChain filterChain = new MockFilterChain();

        filter.doFilter(request, new MockHttpServletResponse(), filterChain);

        assertThat(filterChain.getRequest()).isSameAs(request);
    }

    private SignAntiReplayFilter enabledFilter() {
        SignAntiReplayFilter filter = new SignAntiReplayFilter();
        SignAntiReplayConfig config = new SignAntiReplayConfig();
        config.setEnabled(true);
        ReflectionTestUtils.setField(filter, "signProperties", config);
        return filter;
    }
}
