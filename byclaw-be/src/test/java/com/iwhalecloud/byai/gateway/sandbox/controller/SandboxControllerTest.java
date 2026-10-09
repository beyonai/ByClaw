package com.iwhalecloud.byai.gateway.sandbox.controller;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verifyNoInteractions;

import java.util.Date;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.Test;
import org.slf4j.LoggerFactory;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.gateway.sandbox.mapper.SandboxServiceSpecEntityMapper;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxInfo;
import com.iwhalecloud.byai.gateway.sandbox.model.SandboxRecordView;
import com.iwhalecloud.byai.gateway.sandbox.persistence.SandboxServiceSpecEntity;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.TenantSandboxService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxBrowserNavigationService;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;

import ch.qos.logback.classic.Logger;
import ch.qos.logback.classic.spi.ILoggingEvent;
import ch.qos.logback.core.read.ListAppender;

class SandboxControllerTest {

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void getSandboxInfo_returnsGatewayToken() {
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        SandboxController controller = new SandboxController();
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", sandboxRecordMapper);

        when(sandboxService.sandboxInfo("user001")).thenReturn(List.of(SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .gatewayToken("0123456789abcdef0123456789abcdef")
            .build()));

        // Mock database record to return RUNNING status
        SsSandboxRecord record = new SsSandboxRecord();
        record.setStatus("RUNNING");
        when(sandboxRecordMapper.selectLatestBySandboxId("user001", "openclaw", "sandbox-1"))
            .thenReturn(record);

        ResponseUtil response = controller.getSandboxIdByUserCode(Map.of("userCode", "user001"));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        List<Map<String, Object>> data = (List<Map<String, Object>>) response.getData();
        assertThat(data).hasSize(1);
        assertThat(data.get(0))
            .containsEntry("token", "0123456789abcdef0123456789abcdef")
            .containsEntry("status", "RUNNING")
            .doesNotContainKey("gatewayToken");
    }

    @Test
    void renewSandbox_returnsRenewedSandboxInfo() {
        SandboxService sandboxService = mock(SandboxService.class);
        SandboxController controller = new SandboxController();
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        when(sandboxService.renewSandbox("user001", 123L)).thenReturn(SandboxInfo.builder()
            .sandboxId("sandbox-1")
            .userCode("user001")
            .sandboxType("openclaw")
            .endpoints(List.of("http://host/proxy/18789/chat?token=0123456789abcdef0123456789abcdef"))
            .gatewayToken("0123456789abcdef0123456789abcdef")
            .build());

        ResponseUtil response = controller.renewSandbox(Map.of("userCode", "user001", "resourceId", 123L));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        assertThat(data)
            .containsEntry("userCode", "user001")
            .containsEntry("sandboxType", "openclaw")
            .containsEntry("sandboxId", "sandbox-1")
            .containsEntry("token", "0123456789abcdef0123456789abcdef")
            .doesNotContainKey("gatewayToken");
    }

    @Test
    void listRecords_returnsOpenclawEndpointForJsonStorage() {
        setPlatformManager();
        SandboxController controller = new SandboxController();
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper sandboxRecordMapper = mock(SsSandboxRecordMapper.class);
        ByaiSystemConfigService byaiSystemConfigService = mock(ByaiSystemConfigService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", sandboxRecordMapper);
        ReflectionTestUtils.setField(controller, "byaiSystemConfigService", byaiSystemConfigService);

        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(1L);
        record.setSandboxType("openclaw");
        record.setEndpoint(
            "{\"openclaw\":\"http://host/proxy/18789/chat?token=abc\",\"ui\":\"http://host/proxy/3000?token=abc\"}");
        record.setCreateTime(new Date());
        when(sandboxRecordMapper.selectByPage(null, null, "USER", null, 0, 20)).thenReturn(List.of(record));
        SandboxRecordView view = new SandboxRecordView();
        view.setId(1L);
        view.setSandboxType("openclaw");
        view.setEndpoint(record.getEndpoint());
        view.setWorkerOnline(false);
        when(sandboxService.buildRecordView(record)).thenReturn(view);
        when(sandboxRecordMapper.countByCondition(null, null, "USER", null)).thenReturn(1);
        when(byaiSystemConfigService.getDcSystemConfigValueByCode("WEB_BASE_URL")).thenReturn("");

        ResponseUtil response = controller.listRecords(Map.of());

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<SandboxRecordView> list = (List<SandboxRecordView>) data.get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getEndpoint()).isEqualTo("http://host/proxy/18789/chat?token=abc");
        assertThat(list.get(0).getWorkerOnline()).isFalse();
    }

    @Test
    void listRecords_filtersTenantSandboxRecordsByEnterprise() {
        setPlatformManager();
        SandboxController controller = new SandboxController();
        SandboxService sandboxService = mock(SandboxService.class);
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        ByaiSystemConfigService configService = mock(ByaiSystemConfigService.class);
        TenantSandboxService tenantSandboxService = mock(TenantSandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "byaiSystemConfigService", configService);
        ReflectionTestUtils.setField(controller, "tenantSandboxService", tenantSandboxService);
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(2L);
        record.setSandboxType("tenant-opengauss");
        record.setOwnerScope("TENANT");
        record.setEnterpriseId(11220513L);
        record.setStatus("RUNNING");
        when(mapper.selectByPage(null, null, "TENANT", 11220513L, 0, 20)).thenReturn(List.of(record));
        when(mapper.countByCondition(null, null, "TENANT", 11220513L)).thenReturn(1);
        SandboxRecordView view = new SandboxRecordView();
        view.setId(2L);
        view.setSandboxType("tenant-opengauss");
        view.setOwnerScope("TENANT");
        view.setEnterpriseId(11220513L);
        view.setEndpoint("tcp://db-host:5432");
        when(sandboxService.buildRecordView(record)).thenReturn(view);
        when(tenantSandboxService.providerStatus(record)).thenReturn("MISSING");

        ResponseUtil response = controller.listRecords(Map.of("ownerScope", "TENANT", "enterpriseId", "11220513"));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        @SuppressWarnings("unchecked")
        Map<String, Object> data = (Map<String, Object>) response.getData();
        @SuppressWarnings("unchecked")
        List<SandboxRecordView> list = (List<SandboxRecordView>) data.get("list");
        assertThat(list).hasSize(1);
        assertThat(list.get(0).getEndpoint()).isEqualTo("tcp://db-host:5432");
        assertThat(list.get(0).getProviderStatus()).isEqualTo("MISSING");
        verify(mapper).countByCondition(null, null, "TENANT", 11220513L);
    }

    private void setPlatformManager() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.PLAT_MAN);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("adminvip");
        loginInfo.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @Test
    void businessManagerListDefaultsToItsOwnEnterpriseAndCannotOverrideIt() {
        setBusinessManager();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        when(mapper.selectByPage(null, null, "USER", 123L, 0, 20)).thenReturn(List.of());

        assertThat(controller.listRecords(Map.of("ownerScope", "USER")).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).selectByPage(null, null, "USER", 123L, 0, 20);
        verify(mapper).countByCondition(null, null, "USER", 123L);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.listRecords(
            Map.of("ownerScope", "USER", "enterpriseId", "456")))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("enterprise access denied");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.listRecords(
            Map.of("ownerScope", "TENANT")))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
    }

    @Test
    void businessManagerCannotModifyAnotherEnterpriseSandboxByRecordId() {
        setBusinessManager();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        SsSandboxRecord record = new SsSandboxRecord();
        record.setId(7L);
        record.setEnterpriseId(456L);
        when(mapper.selectById(7L)).thenReturn(record);

        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.updateSandbox(
            Map.of("id", 7L, "autoRelease", 1)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class)
            .hasMessageContaining("enterprise access denied");
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.removeSandboxById(Map.of("id", 7L)))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verifyNoInteractions(service);
    }

    private void setBusinessManager() {
        UsersOrganization organization = new UsersOrganization();
        organization.setUserType(UserType.BUSINESS_MAN);
        LoginInfo login = new LoginInfo();
        login.setUserCode("business-manager");
        login.setEnterpriseId(123L);
        login.setUsersOrganizations(List.of(organization));
        CurrentUserHolder.setLoginInfo(login);
    }

    @Test
    void businessManagerCanModifyAnAccessibleUserSandbox() {
        setBusinessManager();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        SandboxService service = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        ReflectionTestUtils.setField(controller, "sandboxService", service);
        when(mapper.countEnterpriseUserSandbox(7L, 123L)).thenReturn(1);

        assertThat(controller.updateSandbox(Map.of("id", 7L, "autoRelease", 1)).getCode())
            .isEqualTo(ResponseUtil.SUCCESS);
        assertThat(controller.removeSandboxById(Map.of("id", 7L)).getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(service).updateSandboxById(7L, 1);
        verify(service).removeSandboxById(7L);
    }

    @Test
    void userResourcesStillRequireAnAdministrativeRole() {
        CurrentUserHolder.clearLoginInfo();
        SandboxController controller = new SandboxController();
        SsSandboxRecordMapper mapper = mock(SsSandboxRecordMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxRecordMapper", mapper);
        org.assertj.core.api.Assertions.assertThatThrownBy(() -> controller.listRecords(Map.of()))
            .isInstanceOf(org.springframework.web.server.ResponseStatusException.class);
        verifyNoInteractions(mapper);
    }

    @Test
    void saveServiceSpec_defaultsAutoStartToEnabledForLegacyClients() {
        SandboxController controller = new SandboxController();
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxServiceSpecEntityMapper", mapper);
        when(mapper.selectById("openclaw")).thenReturn(null);

        ResponseUtil response = controller.saveServiceSpec(Map.of(
            "serviceKey", "openclaw",
            "specJson", "{}",
            "templateJson", "{}"
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).insertSpec("openclaw", "{}", "{}", 1);
    }

    @Test
    void saveServiceSpec_updatesExplicitAutoStartValue() {
        SandboxController controller = new SandboxController();
        SandboxServiceSpecEntityMapper mapper = mock(SandboxServiceSpecEntityMapper.class);
        ReflectionTestUtils.setField(controller, "sandboxServiceSpecEntityMapper", mapper);
        SandboxServiceSpecEntity existing = new SandboxServiceSpecEntity();
        existing.setServiceKey("byclaw-dsh");
        when(mapper.selectById("byclaw-dsh")).thenReturn(existing);

        ResponseUtil response = controller.saveServiceSpec(Map.of(
            "serviceKey", "byclaw-dsh",
            "specJson", "{}",
            "enabled", false
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(mapper).updateSpec("byclaw-dsh", "{}", null, 0);
    }

    @Test
    void removeSandbox_targetsOneServiceWhenSandboxTypeIsProvided() {
        SandboxController controller = new SandboxController();
        SandboxService sandboxService = mock(SandboxService.class);
        ReflectionTestUtils.setField(controller, "sandboxService", sandboxService);

        ResponseUtil response = controller.removeSandbox(Map.of(
            "userCode", "user001",
            "sandboxType", "byclaw-dsh"
        ));

        assertThat(response.getCode()).isEqualTo(ResponseUtil.SUCCESS);
        verify(sandboxService).removeSandbox("user001", null, "byclaw-dsh");
    }

    @Test
    void navigateBrowser_logsUnexpectedFailureWithRequestContextAndStackTrace() {
        SandboxController controller = new SandboxController();
        SandboxBrowserNavigationService navigationService = mock(SandboxBrowserNavigationService.class);
        ReflectionTestUtils.setField(controller, "sandboxBrowserNavigationService", navigationService);
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserCode("user001");
        CurrentUserHolder.setLoginInfo(loginInfo);
        doThrow(new IllegalStateException("daemon failed https://example.com?ticket=secret-error"))
            .when(navigationService)
            .navigate("user001", "sandbox-1", "https://example.com/login?ticket=private", "operation-account-1");
        MessageSource messageSource = mock(MessageSource.class);
        when(messageSource.getMessage(org.mockito.ArgumentMatchers.anyString(),
            org.mockito.ArgumentMatchers.any(), org.mockito.ArgumentMatchers.any(java.util.Locale.class)))
            .thenReturn("navigation failed");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", messageSource);

        Logger logger = (Logger)LoggerFactory.getLogger(SandboxController.class);
        ListAppender<ILoggingEvent> appender = new ListAppender<>();
        logger.addAppender(appender);
        appender.start();
        try {
            controller.navigateBrowser(Map.of(
                "sandboxId", "sandbox-1",
                "targetUrl", "https://example.com/login?ticket=private",
                "sessionKey", "operation-account-1"
            ));

            assertThat(appender.list).anySatisfy(event -> {
                assertThat(event.getFormattedMessage())
                    .contains("stage=CONTROLLER_FAILURE", "userCode=user001", "sandboxId=sandbox-1")
                    .contains("sessionKey=operation-account-1", "target=https://example.com/login")
                    .contains("stackTrace=java.lang.IllegalStateException")
                    .doesNotContain("ticket=private", "secret-error");
                assertThat(event.getThrowableProxy()).isNull();
            });
        } finally {
            logger.detachAppender(appender);
            appender.stop();
            ReflectionTestUtils.setField(I18nUtil.class, "messageSource", null);
        }
    }
}
