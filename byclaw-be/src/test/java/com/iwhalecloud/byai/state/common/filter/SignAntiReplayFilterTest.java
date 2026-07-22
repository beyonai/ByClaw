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
}
