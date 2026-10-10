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
    void workspaceCenterEndpointsReturnStatusAndSeparateCleanupFailureFromSaveFailure() {
        var controller = new ToolManController();
        var service = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.WorkspaceSkillCenterApplicationService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "workspaceSkillCenterApplicationService", service);
        var request = new com.iwhalecloud.byai.state.domain.resource.qo.WorkspaceSkillCenterQo();
        request.setResourceId(10L);
        request.setSkillPath("/workspace/skills/demo");
        request.setRevision("revision");
        var status = new com.iwhalecloud.byai.state.application.service.session.WorkspaceSkillCenterApplicationService
            .Status("UPDATE", "enterprise", 20L, "revision");
        var result = new com.iwhalecloud.byai.state.application.service.session.WorkspaceSkillCenterApplicationService
            .Result(20L, "UPDATE", false);
        org.mockito.Mockito.when(service.preview(request)).thenReturn(status);
        org.mockito.Mockito.when(service.sync(request)).thenReturn(result);
        assertThat(controller.queryWorkspaceSkillCenterStatus(request).getData()).isEqualTo(status);
        var response = controller.syncWorkspaceSkillToCenter(request);
        assertThat(response.getCode()).isZero();
        assertThat(response.getData().sourceDeleted()).isFalse();
        org.mockito.Mockito.when(service.sync(request)).thenThrow(new IllegalArgumentException("changed"));
        assertThat(controller.syncWorkspaceSkillToCenter(request).getCode()).isEqualTo(-1);
        assertThat(controller.syncWorkspaceSkillToCenter(request).getMsg()).isEqualTo("changed");
    }

    @Test
    void personalDirectoryEndpointsIgnoreClientEmployeeAndUserIdentity() {
        ToolManController controller = new ToolManController();
        var query = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawSkillQueryApplicationService.class);
        var resource = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService.class);
        var deletion = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawSkillDeleteApplicationService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "byClawSkillQueryApplicationService", query);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "byClawSkillResourceApplicationService", resource);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "byClawSkillDeleteApplicationService", deletion);
        LoginInfo login = new LoginInfo();
        login.setUserId(11L);
        login.setUserCode("me");
        login.setDefaultDigEmployeeId(999L);
        CurrentUserHolder.setLoginInfo(login);
        String path = "/.openclaw/workspace/skills/mine";
        org.mockito.Mockito.when(query.resolveMySkillSource(path)).thenReturn(null);
        var request = new com.iwhalecloud.byai.state.domain.resource.qo.WorkspaceSkillQo();
        request.setPersonalWorkspace(true);
        request.setSkillPath(path);
        request.setResourceId(999L);
        request.setUserCode("someone-else");
        var list = new com.iwhalecloud.byai.state.domain.session.qo.QrySkillListByUserCodeQo();
        list.setPersonalWorkspace(true);
        list.setResourceId(999L);
        list.setUserCode("someone-else");
        list.setKeyword("mine");
        var delete = new com.iwhalecloud.byai.state.domain.resource.qo.DeleteSkillQo();
        delete.setPersonalWorkspace(true);
        delete.setSkillPath(path);
        delete.setUserCode("someone-else");
        try (var messages = org.mockito.Mockito.mockStatic(com.iwhalecloud.byai.common.i18n.I18nUtil.class)) {
            assertThat(controller.qryWorkspacePersonalSkillList(list).getCode()).isZero();
            assertThat(controller.getWorkspaceSkillDetail(request).getCode()).isZero();
            assertThat(controller.checkWorkspaceSkillShareConflicts(request).getCode()).isZero();
            assertThat(controller.resourceizeWorkspaceSkill(request).getCode()).isZero();
            assertThat(controller.deleteSkill(delete).getCode()).isZero();
        }
        org.mockito.Mockito.verify(query).qryMyDirectorySkills("mine");
        org.mockito.Mockito.verify(query).getWorkspaceSkillDetail("me", null, path);
        org.mockito.Mockito.verify(resource).previewMyDirectorySkillConflicts(path);
        org.mockito.Mockito.verify(resource).resourceizeMyDirectorySkill(path, false);
        org.mockito.Mockito.verify(deletion).deleteSkill("me", null, path);
        org.mockito.Mockito.verify(resource, org.mockito.Mockito.never()).assertWorkspaceSkillManagePermission(org.mockito.ArgumentMatchers.any());
    }

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

    @Test
    void enterprisePublicationReturnsManifestRejectionWithResourceNames() {
        var controller = new ToolManController();
        var service = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawSkillResourceApplicationService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "byClawSkillResourceApplicationService", service);
        var request = new com.iwhalecloud.byai.manager.dto.resource.ResourceIdDto();
        request.setResourceId(10L);
        String reason = "无法发布到企业：个人工具「订单查询」（ID：2001）；个人知识「产品资料」（ID：3001）。";
        org.mockito.Mockito.when(service.publishSkillToEnterprise(10L)).thenThrow(new IllegalArgumentException(reason));

        var response = controller.publishSkillToEnterprise(request);

        assertThat(response.getCode()).isEqualTo(-1);
        assertThat(response.getMsg()).isEqualTo(reason);
        assertThat(response.getData()).isNull();
    }

    @Test
    void builtinSkillDownloadReturnsCompletePackageForOrdinaryUser() throws Exception {
        var controller = new ToolManController();
        var resources = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService.class);
        var skills = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService.class);
        var exporter = org.mockito.Mockito.mock(
            com.iwhalecloud.byai.state.application.service.session.ByClawBuiltinSkillExportService.class);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "ssResourceService", resources);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "ssResExtSkillService", skills);
        org.springframework.test.util.ReflectionTestUtils.setField(controller, "builtinSkillExportService", exporter);
        var login = new LoginInfo();
        login.setUserCode("ordinary");
        CurrentUserHolder.setLoginInfo(login);
        var resource = new com.iwhalecloud.byai.manager.entity.resource.SsResource();
        resource.setResourceCode("demo");
        var skill = new com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill();
        skill.setSkillType("inner");
        org.mockito.Mockito.when(resources.findById(1L)).thenReturn(resource);
        org.mockito.Mockito.when(skills.findById(1L)).thenReturn(skill);
        byte[] zip = new byte[] {80, 75, 3, 4};
        org.mockito.Mockito.when(exporter.exportPackage("ordinary", "demo")).thenReturn(zip);
        var response = controller.downloadSkillZip(null, 1L, null, null, null);
        assertThat(response.getStatusCode().value()).isEqualTo(200);
        assertThat(response.getHeaders().getFirst("Content-Disposition")).contains("demo.zip");
        var output = new java.io.ByteArrayOutputStream();
        response.getBody().writeTo(output);
        assertThat(output.toByteArray()).isEqualTo(zip);
        org.mockito.Mockito.verify(exporter).exportPackage("ordinary", "demo");
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
