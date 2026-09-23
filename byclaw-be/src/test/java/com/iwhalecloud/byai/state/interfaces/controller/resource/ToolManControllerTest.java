package com.iwhalecloud.byai.state.interfaces.controller.resource;

import static org.assertj.core.api.Assertions.assertThat;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.state.domain.resource.qo.ThirdPartySkillInstallQo;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.mock.web.MockHttpSession;

class ToolManControllerTest {

    @Test
    void enterprisePublicationReturnsCopyAndPropagatesPermissionDenial() {
        ToolManController controller = new ToolManController();
        var service = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "byClawSkillResourceApplicationService", service);
        var request = new com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto();
        request.setResourceId(10L);
        var target = new com.iwhalecloud.byai.manager.entity.resource.SsResource();
        target.setResourceId(11L);
        var result = new com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService
            .EnterpriseSkillPublishResult(target, false);
        org.mockito.Mockito.when(service.publishSkillToEnterprise(10L)).thenReturn(result);
        var response = controller.publishSkillToEnterprise(request);
        assertThat(response.getCode()).isZero();
        assertThat(response.getData().resource().getResourceId()).isEqualTo(11L);
        org.mockito.Mockito.when(service.publishSkillToEnterprise(10L))
            .thenThrow(new IllegalArgumentException("Permission denied"));
        assertThat(controller.publishSkillToEnterprise(request).getCode()).isEqualTo(-1);
        assertThat(controller.publishSkillToEnterprise(request).getMsg()).isEqualTo("Permission denied");
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void lifecycleEndpointsDispatchToDistinctOperations() {
        ToolManController controller = new ToolManController();
        com.iwhalecloud.byai.state.domain.resource.service.ToolManService service =
            org.mockito.Mockito.mock(com.iwhalecloud.byai.state.domain.resource.service.ToolManService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "toolManService", service);
        com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto request =
            new com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto();
        request.setResourceId(10L);
        try (org.mockito.MockedStatic<com.iwhalecloud.byai.common.i18n.I18nUtil> messages =
                 org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.i18n.I18nUtil.class)) {
            controller.shelfResource(request);
            controller.unShelfResource(request);
            controller.deregisterResource(request);
        }
        org.mockito.Mockito.verify(service).shelfResource(10L);
        org.mockito.Mockito.verify(service).unShelfResource(10L);
        org.mockito.Mockito.verify(service).deregisterResource(10L);
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
