package com.iwhalecloud.byai.state.interfaces.controller.resource;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.resource.qo.ThirdPartySkillInstallQo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class ToolManControllerTest {

    @Test
    void legacyMcpEndpointRejectsPersonalResourceBeforeNetworkAccess() {
        ToolManController controller = new ToolManController();
        SsResourceService resourceService = mock(SsResourceService.class);
        SsResource resource = new SsResource();
        resource.setResourceBizType("MCP");
        resource.setOwnerType("personal");
        when(resourceService.findById(9L)).thenReturn(resource);
        ReflectionTestUtils.setField(controller, "ssResourceService", resourceService);
        ResourceIdDto request = new ResourceIdDto();
        request.setResourceId(9L);

        assertThatThrownBy(() -> controller.listTools(request))
            .isInstanceOf(SecurityException.class)
            .hasMessageContaining("instance-aware");
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void serializeThirdPartySkillInstallRequestKeepsCompleteParameters() {
        ThirdPartySkillInstallQo request = new ThirdPartySkillInstallQo();
        request.setDigId(10005856L);
        request.setDownloadUrl(
            "https://user:secret@example.com/skills/demo.zip?skillIds=123&token=secret#fragment");

        assertThat(ToolManController.serializeThirdPartySkillInstallRequest(request))
            .isEqualTo("{\"digId\":10005856,"
                + "\"downloadUrl\":\"https://user:secret@example.com/skills/demo.zip"
                + "?skillIds=123&token=secret#fragment\"}");
    }

    @Test
    void serializeThirdPartySkillInstallRequestHandlesNullRequest() {
        assertThat(ToolManController.serializeThirdPartySkillInstallRequest(null)).isEqualTo("null");
    }

    @Test
    void serializeThirdPartySkillInstallRequestContextKeepsCompleteTokenHeadersSessionAndBody() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10001L);
        loginInfo.setUserCode("user001");
        loginInfo.setUserName("测试用户");
        loginInfo.setEnterpriseId(1L);
        loginInfo.setAssistantId(20001L);
        loginInfo.setDefaultDigEmployeeId(9001L);
        loginInfo.setSessionDatasetId(30001L);
        CurrentUserHolder.setLoginInfo(loginInfo);

        ThirdPartySkillInstallQo requestBody = new ThirdPartySkillInstallQo();
        requestBody.setDigId(9001L);
        requestBody.setDownloadUrl("https://market.example/download?skillIds=123&token=raw-download-token");

        MockHttpServletRequest httpRequest = new MockHttpServletRequest("POST", "/tool/installThirdPartySkill");
        httpRequest.setScheme("https");
        httpRequest.setServerName("portal.example.com");
        httpRequest.setServerPort(443);
        httpRequest.setRemoteAddr("10.0.0.8");
        httpRequest.setContentType("application/json");
        httpRequest.addHeader("Beyond-Token", "raw-beyond-token");
        httpRequest.addHeader("system-code", "BYAI");
        httpRequest.addHeader("Origin", "https://market.example");
        httpRequest.addParameter("traceId", "trace-001");
        MockHttpSession session = new MockHttpSession();
        session.setAttribute("USER_CODE", "session-user001");
        session.setAttribute("defaultDigEmployeeId", "9001");
        httpRequest.setSession(session);

        String context = ToolManController.serializeThirdPartySkillInstallRequestContext(httpRequest, requestBody);

        assertThat(context).contains(
            "\"beyondToken\":\"raw-beyond-token\"",
            "\"Beyond-Token\":[\"raw-beyond-token\"]",
            "\"systemCode\":\"BYAI\"",
            "\"authenticationSource\":\"BEYOND_TOKEN\"",
            "\"httpSessionAttributes\":{\"USER_CODE\":\"session-user001\",\"defaultDigEmployeeId\":\"9001\"}",
            "\"traceId\":[\"trace-001\"]",
            "\"digId\":9001",
            "raw-download-token",
            "\"currentUserId\":10001",
            "\"currentDefaultDigEmployeeId\":9001");
    }
}
