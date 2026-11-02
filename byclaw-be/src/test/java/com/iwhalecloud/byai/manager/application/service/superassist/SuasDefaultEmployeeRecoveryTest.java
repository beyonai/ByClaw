package com.iwhalecloud.byai.manager.application.service.superassist;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import org.junit.jupiter.api.*;
import org.springframework.test.util.ReflectionTestUtils;
import static org.junit.jupiter.api.Assertions.*;
import static org.mockito.Mockito.*;

class SuasDefaultEmployeeRecoveryTest {
    SuasSuperassistApplicationService service;
    SsResourceService resources;
    SuasSuperassistService assistants;
    DigitalEmployeeApplicationService employees;
    ByaiSystemConfigService config;
    LoginInfo login;
    SuasSuperassist assistant;
    SsResource main;

    @BeforeEach void setup() {
        service=new SuasSuperassistApplicationService();resources=mock(SsResourceService.class);
        assistants=mock(SuasSuperassistService.class);employees=mock(DigitalEmployeeApplicationService.class);
        config=mock(ByaiSystemConfigService.class);
        ReflectionTestUtils.setField(service,"ssResourceService",resources);
        ReflectionTestUtils.setField(service,"suasSuperassistService",assistants);
        ReflectionTestUtils.setField(service,"digitalEmployeeApplicationService",employees);
        ReflectionTestUtils.setField(service,"byaiSystemConfigService",config);
        ReflectionTestUtils.setField(service,"ssResExtDigEmployeeService",mock(SsResExtDigEmployeeService.class));
        ReflectionTestUtils.setField(service,"ssResExtSkillService",mock(SsResExtSkillService.class));
        login=new LoginInfo();login.setAssistantId(7L);login.setUserId(7L);login.setUserCode("u7");login.setLanguage("zh_CN");login.setDefaultDigEmployeeId(999L);
        assistant=new SuasSuperassist();assistant.setSuperassistId(7L);assistant.setSessionDatasetId(10L);assistant.setDefaultDigEmployeeId(999L);
        when(assistants.findById(7L)).thenReturn(assistant);
        when(config.findByParamCode("INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE")).thenReturn("{\"zh_CN\":[{\"resourceCode\":\"${userCode}_main\",\"isDefaultDigEmployee\":\"Y\"}]}");
        main=new SsResource();main.setResourceId(77L);main.setResourceCode("u7_main");main.setManUserId("7");main.setResourceBizType("DIG_EMPLOYEE");
        when(resources.findByIdOrCode(null,"u7_main")).thenReturn(main);
    }
    @AfterEach void cleanup() {CurrentUserHolder.clearLoginInfo();}

    @Test void deletedDefaultIsReplacedByTheExistingOwnedTemplateWithoutCreatingAnEmployee() {
        SuasSuperassist result=service.createDatasetIfNotExists(login);
        assertNotNull(result);assertEquals(77L,result.getDefaultDigEmployeeId());assertEquals(77L,login.getDefaultDigEmployeeId());
        verify(employees,never()).saveDigitalEmployee(any());verify(assistants).updateById(assistant);
    }
    @Test void validCustomDefaultIsPreserved() {
        SsResource custom=new SsResource();custom.setResourceId(999L);when(resources.findById(999L)).thenReturn(custom);
        assertEquals(999L,service.createDatasetIfNotExists(login).getDefaultDigEmployeeId());
    }
    @Test void recoveryDoesNotAdoptOrMutateAnotherOwnersTemplate() {
        main.setManUserId("other-owner");
        SuasSuperassist result=service.createDatasetIfNotExists(login);
        assertNotNull(result);assertNull(result.getDefaultDigEmployeeId());
        verifyNoInteractions(employees);verify(resources,never()).update(any());
    }
    @Test void missingTemplateConfigurationClearsTheDanglingReferenceWithoutChoosingAnArbitraryEmployee() {
        when(config.findByParamCode("INIT_DEFAULT_DIGEMPLOYEE_TEMPLATE")).thenReturn(null);
        assertNull(service.createDatasetIfNotExists(login).getDefaultDigEmployeeId());
        verifyNoInteractions(employees);
    }
}
