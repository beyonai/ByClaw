package com.iwhalecloud.byai.manager.application.service.superassist;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.application.service.dataset.DatasetApplicationService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import java.util.Collections;
import java.util.List;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SuasSuperassistApplicationServiceTest {

    private SuasSuperassistService suasSuperassistService;

    private SsResourceService ssResourceService;

    private SsResourceMapper ssResourceMapper;

    private DatasetApplicationService datasetApplicationService;

    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    private SuasSuperassistApplicationService service;

    @BeforeEach
    void setUp() {
        suasSuperassistService = mock(SuasSuperassistService.class);
        ssResourceService = mock(SsResourceService.class);
        ssResourceMapper = mock(SsResourceMapper.class);
        datasetApplicationService = mock(DatasetApplicationService.class);
        digitalEmployeeApplicationService = mock(DigitalEmployeeApplicationService.class);

        service = new SuasSuperassistApplicationService();
        ReflectionTestUtils.setField(service, "suasSuperassistService", suasSuperassistService);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "datasetApplicationService", datasetApplicationService);
        ReflectionTestUtils.setField(service, "digitalEmployeeApplicationService", digitalEmployeeApplicationService);

        when(ssResourceMapper.selectList(any())).thenReturn(Collections.emptyList());
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.clearLoginInfo();
    }

    @Test
    void createDefaultResourcesIfNotExists_usesDatasetAndDigitalEmployeeSavePipelines() {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(7L);
        loginInfo.setUserCode("zhangsan");
        loginInfo.setUserName("张三");
        loginInfo.setAssistantId(7L);
        loginInfo.setEnterpriseId(10L);
        UsersOrganization usersOrganization = new UsersOrganization();
        usersOrganization.setOrgId(20L);
        usersOrganization.setPathCode("20");
        loginInfo.setUsersOrganizations(List.of(usersOrganization));

        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(7L);
        when(suasSuperassistService.findById(7L)).thenReturn(suasSuperassist);

        SsResource dataset = new SsResource();
        dataset.setResourceId(101L);
        dataset.setResourceBizType(ResourceBizTypeEnum.KG_DOC.name());
        dataset.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        when(datasetApplicationService.createDefaultPersonalDataset(7L, "zhangsan", "张三")).thenReturn(dataset);

        SsResource defaultAssistant = new SsResource();
        defaultAssistant.setResourceId(202L);
        defaultAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        defaultAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        when(digitalEmployeeApplicationService.saveDefaultSuperAssistant(7L, "zhangsan", "张三", dataset))
            .thenReturn(defaultAssistant);

        SuasSuperassist result = service.createDefaultResourcesIfNotExists(loginInfo, false);

        assertThat(result.getSessionDatasetId()).isEqualTo(101L);
        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(202L);
        assertThat(loginInfo.getSessionDatasetId()).isNull();
        assertThat(CurrentUserHolder.getLoginInfo()).isSameAs(loginInfo);
        verify(datasetApplicationService).createDefaultPersonalDataset(7L, "zhangsan", "张三");
        verify(digitalEmployeeApplicationService).saveDefaultSuperAssistant(7L, "zhangsan", "张三", dataset);
        verify(suasSuperassistService, times(2)).updateById(suasSuperassist);
    }

    @Test
    void createDefaultResourcesIfNotExists_createsSuperassistWhenMissing() {
        when(suasSuperassistService.findById(8L)).thenReturn(null);

        SsResource dataset = new SsResource();
        dataset.setResourceId(301L);
        dataset.setResourceBizType(ResourceBizTypeEnum.KG_DOC.name());
        dataset.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        when(datasetApplicationService.createDefaultPersonalDataset(8L, "lisi", "李四")).thenReturn(dataset);

        SsResource defaultAssistant = new SsResource();
        defaultAssistant.setResourceId(302L);
        defaultAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        defaultAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        when(digitalEmployeeApplicationService.saveDefaultSuperAssistant(8L, "lisi", "李四", dataset))
            .thenReturn(defaultAssistant);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(8L);
        loginInfo.setUserCode("lisi");
        loginInfo.setUserName("李四");
        loginInfo.setAssistantId(8L);

        service.createDefaultResourcesIfNotExists(loginInfo, false);

        ArgumentCaptor<SuasSuperassist> captor = ArgumentCaptor.forClass(SuasSuperassist.class);
        verify(suasSuperassistService).addSuasSuperassist(captor.capture());
        assertThat(captor.getValue().getSuperassistId()).isEqualTo(8L);
        assertThat(captor.getValue().getName()).isEqualTo("李四");
    }

    /**
     * dataset.system=WHALE_AGENT 时跳过默认个人知识库创建，但仍初始化默认超级助手。
     *
     * @author qin.guoquan
     * @date 2026-05-07 171200
     */
    @Test
    void createDefaultResourcesIfNotExists_whenWhaleAgentSkipsDefaultDatasetCreation() {
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");

        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(10L);
        when(suasSuperassistService.findById(10L)).thenReturn(suasSuperassist);

        SsResource defaultAssistant = new SsResource();
        defaultAssistant.setResourceId(502L);
        defaultAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        defaultAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        when(digitalEmployeeApplicationService.saveDefaultSuperAssistant(10L, "zhaoliu", "赵六", null))
            .thenReturn(defaultAssistant);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(10L);
        loginInfo.setUserCode("zhaoliu");
        loginInfo.setUserName("赵六");
        loginInfo.setAssistantId(10L);

        SuasSuperassist result = service.createDefaultResourcesIfNotExists(loginInfo, false);

        assertThat(result.getSessionDatasetId()).isNull();
        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(502L);
        verify(datasetApplicationService, never()).createDefaultPersonalDataset(10L, "zhaoliu", "赵六");
        verify(digitalEmployeeApplicationService).saveDefaultSuperAssistant(10L, "zhaoliu", "赵六", null);
        verify(suasSuperassistService).updateById(suasSuperassist);
    }

    @Test
    void createDefaultResourcesIfNotExists_continuesAssistantCreationWhenDatasetFails() {
        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(9L);
        when(suasSuperassistService.findById(9L)).thenReturn(suasSuperassist);
        when(datasetApplicationService.createDefaultPersonalDataset(9L, "wangwu", "王五"))
            .thenThrow(new RuntimeException("Create Knowledge fail"));

        SsResource defaultAssistant = new SsResource();
        defaultAssistant.setResourceId(402L);
        defaultAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        defaultAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        when(digitalEmployeeApplicationService.saveDefaultSuperAssistant(9L, "wangwu", "王五", null))
            .thenReturn(defaultAssistant);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(9L);
        loginInfo.setUserCode("wangwu");
        loginInfo.setUserName("王五");
        loginInfo.setAssistantId(9L);

        SuasSuperassist result = service.createDefaultResourcesIfNotExists(loginInfo, false);

        assertThat(result.getSessionDatasetId()).isNull();
        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(402L);
        verify(digitalEmployeeApplicationService).saveDefaultSuperAssistant(9L, "wangwu", "王五", null);
        verify(suasSuperassistService).updateById(suasSuperassist);
    }

    /**
     * 登录初始化优先按 resource_code={userCode}_main 复用默认超级助手，避免重复创建。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     */
    @Test
    void createDefaultResourcesIfNotExists_reusesDefaultSuperAssistantByResourceCode() {
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");

        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(11L);
        when(suasSuperassistService.findById(11L)).thenReturn(suasSuperassist);

        SsResource existingDefaultSuperAssistant = new SsResource();
        existingDefaultSuperAssistant.setResourceId(602L);
        existingDefaultSuperAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        existingDefaultSuperAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        existingDefaultSuperAssistant.setResourceCode("chenqi_main");
        when(ssResourceMapper.selectList(any())).thenReturn(List.of(existingDefaultSuperAssistant));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(11L);
        loginInfo.setUserCode("chenqi");
        loginInfo.setUserName("陈七");
        loginInfo.setAssistantId(11L);

        SuasSuperassist result = service.createDefaultResourcesIfNotExists(loginInfo, false);

        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(602L);
        verify(digitalEmployeeApplicationService, never()).saveDefaultSuperAssistant(any(), any(), any(), any());
        verify(suasSuperassistService).updateById(suasSuperassist);
    }

    /**
     * 用户把普通个人助理设为默认后，登录初始化只复用 _main 超级助手资源，不能覆盖用户当前默认助理选择。
     */
    @Test
    void createDefaultResourcesIfNotExists_keepsUserSelectedDefaultAssistantWhenMainSuperAssistantExists() {
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");

        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(12L);
        suasSuperassist.setDefaultDigEmployeeId(701L);
        when(suasSuperassistService.findById(12L)).thenReturn(suasSuperassist);

        SsResource selectedDefaultAssistant = new SsResource();
        selectedDefaultAssistant.setResourceId(701L);
        selectedDefaultAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        selectedDefaultAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        selectedDefaultAssistant.setCreateBy(12L);
        selectedDefaultAssistant.setResourceCode("chenba-personal-assistant");
        when(ssResourceService.findById(701L)).thenReturn(selectedDefaultAssistant);

        SsResource existingDefaultSuperAssistant = new SsResource();
        existingDefaultSuperAssistant.setResourceId(702L);
        existingDefaultSuperAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        existingDefaultSuperAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        existingDefaultSuperAssistant.setResourceCode("chenba_main");
        when(ssResourceMapper.selectList(any())).thenReturn(List.of(existingDefaultSuperAssistant));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(12L);
        loginInfo.setUserCode("chenba");
        loginInfo.setUserName("陈八");
        loginInfo.setAssistantId(12L);

        SuasSuperassist result = service.createDefaultResourcesIfNotExists(loginInfo, false);

        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(701L);
        verify(digitalEmployeeApplicationService, never()).saveDefaultSuperAssistant(any(), any(), any(), any());
        verify(suasSuperassistService, never()).updateById(suasSuperassist);
    }

    /**
     * 用户已有默认个人助理但 _main 超级助手缺失时，登录初始化会补建 _main 资源，但不改 default_dig_employee_id。
     */
    @Test
    void createDefaultResourcesIfNotExists_createsMainSuperAssistantWithoutOverwritingUserSelectedDefault() {
        ReflectionTestUtils.setField(service, "datasetSystem", "WHALE_AGENT");

        SuasSuperassist suasSuperassist = new SuasSuperassist();
        suasSuperassist.setSuperassistId(13L);
        suasSuperassist.setDefaultDigEmployeeId(801L);
        when(suasSuperassistService.findById(13L)).thenReturn(suasSuperassist);

        SsResource selectedDefaultAssistant = new SsResource();
        selectedDefaultAssistant.setResourceId(801L);
        selectedDefaultAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        selectedDefaultAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        selectedDefaultAssistant.setCreateBy(13L);
        selectedDefaultAssistant.setResourceCode("chenjiu-personal-assistant");
        when(ssResourceService.findById(801L)).thenReturn(selectedDefaultAssistant);

        SsResource createdDefaultSuperAssistant = new SsResource();
        createdDefaultSuperAssistant.setResourceId(802L);
        createdDefaultSuperAssistant.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        createdDefaultSuperAssistant.setOwnerType(OwnerType.PERSONAL_DEFAULT);
        createdDefaultSuperAssistant.setResourceCode("chenjiu_main");
        when(digitalEmployeeApplicationService.saveDefaultSuperAssistant(13L, "chenjiu", "陈九", null))
            .thenReturn(createdDefaultSuperAssistant);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(13L);
        loginInfo.setUserCode("chenjiu");
        loginInfo.setUserName("陈九");
        loginInfo.setAssistantId(13L);

        SuasSuperassist result = service.createDefaultResourcesIfNotExists(loginInfo, false);

        assertThat(result.getDefaultDigEmployeeId()).isEqualTo(801L);
        verify(digitalEmployeeApplicationService).saveDefaultSuperAssistant(13L, "chenjiu", "陈九", null);
        verify(suasSuperassistService, never()).updateById(suasSuperassist);
    }
}
