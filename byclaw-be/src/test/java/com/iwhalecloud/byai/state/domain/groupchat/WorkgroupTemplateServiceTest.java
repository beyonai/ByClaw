package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

import java.util.List;
import java.util.Locale;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.dto.orchestrator.OrchestratorRuntimeDTO;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiWorkgroupTemplate;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiWorkgroupTemplateResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiWorkgroupTemplateMapper;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiWorkgroupTemplateResourceMapper;
import com.iwhalecloud.byai.state.common.config.I18nConfig;
import com.iwhalecloud.byai.state.domain.groupchat.application.WorkgroupTemplateService;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateRequest;
import com.iwhalecloud.byai.state.domain.groupchat.dto.WorkgroupTemplateResponse;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.context.MessageSource;
import org.springframework.context.i18n.LocaleContext;
import org.springframework.context.i18n.LocaleContextHolder;
import org.springframework.http.HttpStatus;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.web.server.ResponseStatusException;

class WorkgroupTemplateServiceTest {
    private final ByaiWorkgroupTemplateMapper mapper = mock(ByaiWorkgroupTemplateMapper.class);
    private final ByaiWorkgroupTemplateResourceMapper relations = mock(ByaiWorkgroupTemplateResourceMapper.class);
    private final SequenceService sequence = mock(SequenceService.class);
    private final DigitalEmployeeGroupApplicationService groups = mock(DigitalEmployeeGroupApplicationService.class);
    private final SsResourceCatalogService catalogs = mock(SsResourceCatalogService.class);
    private final ByaiSystemConfigService config = mock(ByaiSystemConfigService.class);
    private final WorkgroupTemplateService service = new WorkgroupTemplateService(
        mapper, relations, sequence, groups, catalogs, config);
    private MessageSource originalMessageSource;
    private LocaleContext originalLocaleContext;

    @BeforeEach
    void setUp() {
        LoginInfo login = new LoginInfo();
        login.setUserId(118L);
        login.setUserCode("adminvip");
        login.setEnterpriseId(2L);
        CurrentUserHolder.setLoginInfo(login);
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("opensource");
        when(sequence.nextVal()).thenReturn(200L);
        ByaiWorkgroupTemplateResource relation = new ByaiWorkgroupTemplateResource();
        relation.setTemplateId(200L);
        relation.setResourceId(11055690L);
        when(relations.selectList(any())).thenReturn(List.of(relation));
        OrchestratorRuntimeDTO runtime = new OrchestratorRuntimeDTO();
        OrchestratorRuntimeDTO.Orchestrator employee = new OrchestratorRuntimeDTO.Orchestrator();
        employee.setId("11055690");
        employee.setName("测试员工");
        employee.setKind("DIGITAL_EMPLOYEE");
        runtime.setOrchestrator(employee);
        when(groups.resolveTemplateResource(11055690L)).thenReturn(runtime);
        originalMessageSource = (MessageSource) ReflectionTestUtils.getField(I18nUtil.class, "messageSource");
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", new I18nConfig().messageSource());
        originalLocaleContext = LocaleContextHolder.getLocaleContext();
        LocaleContextHolder.setLocale(Locale.SIMPLIFIED_CHINESE);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", originalMessageSource);
        LocaleContextHolder.setLocaleContext(originalLocaleContext);
    }

    @ParameterizedTest
    @CsvSource(value = {"10, 1", "54, 1", "0, 1", "54, NULL", "54, 2"}, nullValues = "NULL")
    void createsAndResolvesTemplateUsingGlobalAssetCatalog(Long catalogId, Long catalogEnterpriseId) {
        // 覆盖 HAR 中的 10/54，以及合法的“其他领域”0 和未设置企业归属的管理目录。
        when(catalogs.findById(catalogId)).thenReturn(catalog(catalogId, 6, catalogEnterpriseId));

        WorkgroupTemplateResponse saved = service.save(null, request(catalogId));

        assertThat(saved.getTemplate().getCatalogId()).isEqualTo(catalogId);
        assertThat(saved.getTemplate().getVersion()).isEqualTo(1L);
        assertThat(saved.getCatalogName()).isEqualTo("资产目录");
        assertThat(saved.getResources()).extracting(WorkgroupTemplateResponse.Resource::getResourceId)
            .containsExactly("11055690");
        verify(mapper).insert(saved.getTemplate());
        verify(relations).insert(any(ByaiWorkgroupTemplateResource.class));

        when(mapper.selectById(200L)).thenReturn(saved.getTemplate());
        assertThat(service.requireEnabled(200L, 1L).getCatalogName()).isEqualTo("资产目录");
        when(mapper.selectList(any())).thenReturn(List.of(saved.getTemplate()));
        assertThat(service.listForManagement()).hasSize(1);
    }

    @Test
    void updatesTemplateToGlobalCatalogAndKeepsVersionAndResourceRelations() {
        ByaiWorkgroupTemplate stored = new ByaiWorkgroupTemplate();
        stored.setTemplateId(200L);
        stored.setVersion(3L);
        when(mapper.selectById(200L)).thenReturn(stored);
        when(catalogs.findById(54L)).thenReturn(catalog(54L, 6, 1L));
        WorkgroupTemplateRequest request = request(54L);
        request.setExpectedVersion(3L);

        WorkgroupTemplateResponse saved = service.save(200L, request);

        assertThat(saved.getTemplate().getVersion()).isEqualTo(4L);
        assertThat(saved.getTemplate().getCatalogId()).isEqualTo(54L);
        verify(mapper).updateById(stored);
        verify(mapper, never()).insert(any(ByaiWorkgroupTemplate.class));
        verify(relations).insert(any(ByaiWorkgroupTemplateResource.class));
    }

    @Test
    void rejectsMissingCatalogBeforeWritingTemplate() {
        assertUnavailableCatalog("资产目录不存在或不可用");
        verifyNoInteractions(groups, sequence, mapper, relations);
    }

    @Test
    void rejectsNonAssetCatalogWithLocalizedReasonBeforeWritingTemplate() {
        LocaleContextHolder.setLocale(Locale.US);
        when(catalogs.findById(54L)).thenReturn(catalog(54L, 7, 2L));

        assertUnavailableCatalog("Asset catalog does not exist or is unavailable");
        verifyNoInteractions(groups, sequence, mapper, relations);
    }

    @Test
    void stillRejectsUnavailableEmployeeBeforeWritingTemplate() {
        when(catalogs.findById(54L)).thenReturn(catalog(54L, 6, 1L));
        when(groups.resolveTemplateResource(11055690L))
            .thenThrow(new ResponseStatusException(HttpStatus.FORBIDDEN, "当前用户无数字员工使用权限"));

        assertThatThrownBy(() -> service.save(null, request(54L)))
            .isInstanceOf(ResponseStatusException.class);
        verifyNoInteractions(sequence, mapper, relations);
    }

    @Test
    void stillRejectsStaleTemplateVersionBeforeWritingTemplate() {
        ByaiWorkgroupTemplate stored = new ByaiWorkgroupTemplate();
        stored.setVersion(4L);
        when(mapper.selectById(200L)).thenReturn(stored);
        WorkgroupTemplateRequest request = request(54L);
        request.setExpectedVersion(3L);

        assertThatThrownBy(() -> service.save(200L, request))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.CONFLICT));
        verifyNoInteractions(catalogs, groups, sequence, relations);
        verify(mapper, never()).updateById(any(ByaiWorkgroupTemplate.class));
    }

    @Test
    void stillRestrictsManagementToOpenSourceAdminvip() {
        when(config.getDcSystemConfigValueByCode("BYAI_BRAND_VERSION")).thenReturn("commercial");

        assertThatThrownBy(() -> service.save(null, request(54L)))
            .isInstanceOfSatisfying(ResponseStatusException.class,
                error -> assertThat(error.getStatusCode()).isEqualTo(HttpStatus.FORBIDDEN));
        verifyNoInteractions(catalogs, groups, sequence, mapper, relations);
    }

    private void assertUnavailableCatalog(String reason) {
        assertThatThrownBy(() -> service.save(null, request(54L)))
            .isInstanceOfSatisfying(ResponseStatusException.class, error -> {
                assertThat(error.getStatusCode()).isEqualTo(HttpStatus.NOT_FOUND);
                assertThat(error.getReason()).isEqualTo(reason);
            });
    }

    private SsResourceCatalog catalog(Long id, Integer type, Long enterpriseId) {
        SsResourceCatalog catalog = new SsResourceCatalog();
        catalog.setCatalogId(id);
        catalog.setCatalogName("资产目录");
        catalog.setCatalogType(type);
        catalog.setComAcctId(enterpriseId);
        return catalog;
    }

    private WorkgroupTemplateRequest request(Long catalogId) {
        WorkgroupTemplateRequest request = new WorkgroupTemplateRequest();
        request.setTemplateName("测试模板");
        request.setCatalogId(catalogId);
        request.setSummary("测试摘要");
        request.setDefaultGroupName("测试工作组");
        request.setDefaultGoal("测试目标");
        request.setResourceIds(List.of(11055690L));
        return request;
    }
}
