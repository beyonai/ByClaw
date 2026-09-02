package com.iwhalecloud.byai.state.application.service.index;

import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketExtVo;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.List;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.context.ApplicationContext;
import org.springframework.context.MessageSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class IndexApplicationServiceV2Test {

    private IndexService indexService;
    private IndexApplicationServiceV2 service;

    @BeforeEach
    void setUp() {
        indexService = mock(IndexService.class);

        ResourceAuthContextService resourceAuthContextService = mock(ResourceAuthContextService.class);
        SandboxService sandboxService = mock(SandboxService.class);
        SsResourceCatalogService ssResourceCatalogService = mock(SsResourceCatalogService.class);
        SuasSuperassistService suasSuperassistService = mock(SuasSuperassistService.class);

        MessageSource mockMessageSource = mock(MessageSource.class);
        when(mockMessageSource.getMessage(any(String.class), any(), any(java.util.Locale.class)))
            .thenAnswer(invocation -> invocation.getArgument(0));
        ApplicationContext applicationContext = mock(ApplicationContext.class);
        when(applicationContext.getBean(MessageSource.class)).thenReturn(mockMessageSource);
        ReflectionTestUtils.setField(ApplicationContextUtil.class, "applicationContext", applicationContext);
        ReflectionTestUtils.setField(I18nUtil.class, "messageSource", mockMessageSource);

        service = new IndexApplicationServiceV2();
        ReflectionTestUtils.setField(service, "indexService", indexService);
        ReflectionTestUtils.setField(service, "resourceAuthContextService", resourceAuthContextService);
        ReflectionTestUtils.setField(service, "sandboxService", sandboxService);
        ReflectionTestUtils.setField(service, "ssResourceCatalogService", ssResourceCatalogService);
        ReflectionTestUtils.setField(service, "suasSuperassistService", suasSuperassistService);

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(1L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void discoverFillsRuntimeTagNameWhenStoredTagNameIsEmpty() {
        DigitEmployMarketExtVo superAssistant = buildDigitEmployee(100L, OwnerType.PERSONAL, "zhangsan_main", null);
        DigitEmployMarketExtVo dataAgent = buildDigitEmployee(101L, OwnerType.ENTERPRISE, "data-agent",
            DigitalEmployType.AGENT_TYPE_DATA.getCode());
        DigitEmployMarketExtVo thirdPartyAgent = buildDigitEmployee(102L, OwnerType.ENTERPRISE, "third-party-agent",
            DigitalEmployType.AGENT_TYPE_QA.getCode());
        thirdPartyAgent.setCreateType("FROM_THIRD");
        List<DigitEmployMarketExtVo> discoverList = List.of(superAssistant, dataAgent, thirdPartyAgent);

        when(indexService.discover(any(DiscoverQo.class))).thenReturn(discoverList);
        when(indexService.findManPrivVo(any())).thenReturn(Collections.emptyMap());

        service.discover(new DiscoverQo());

        assertThat(superAssistant.getTagName()).isEqualTo("digemployee.tag.super.assistant");
        assertThat(dataAgent.getTagName()).isEqualTo("digemployee.tag.agent.data");
        assertThat(thirdPartyAgent.getTagName()).isEqualTo("digemployee.tag.third.party");
    }

    @Test
    void authDigitEmployDefaultAndRuntimeTagNameUsesSameRuleAsMyAuthEmploy() {
        AuthDigitEmployVo personalAssistant = new AuthDigitEmployVo();
        personalAssistant.setId(100L);
        personalAssistant.setOwnerType(OwnerType.PERSONAL);
        personalAssistant.setResourceCode("zhangsan_assistant");

        AuthDigitEmployVo qaAgent = new AuthDigitEmployVo();
        qaAgent.setId(101L);
        qaAgent.setOwnerType(OwnerType.ENTERPRISE);
        qaAgent.setResourceCode("qa-agent");
        qaAgent.setAgentType(DigitalEmployType.AGENT_TYPE_QA.getCode());

        AuthDigitEmployVo thirdPartyPersonalAssistant = new AuthDigitEmployVo();
        thirdPartyPersonalAssistant.setId(102L);
        thirdPartyPersonalAssistant.setOwnerType(OwnerType.PERSONAL);
        thirdPartyPersonalAssistant.setResourceCode("lisi_main");
        thirdPartyPersonalAssistant.setAgentType(DigitalEmployType.AGENT_TYPE_ASSISTANT.getCode());
        thirdPartyPersonalAssistant.setCreateType("FROM_THIRD");

        AuthDigitEmployVo employeeGroup = new AuthDigitEmployVo();
        employeeGroup.setId(103L);
        employeeGroup.setOwnerType(OwnerType.ENTERPRISE);
        employeeGroup.setResourceCode("delivery-team");
        employeeGroup.setAgentType(DigitalEmployType.AGENT_TYPE_GROUP.getCode());

        ReflectionTestUtils.invokeMethod(service, "fillDefaultAndRuntimeTag", personalAssistant, 100L);
        ReflectionTestUtils.invokeMethod(service, "fillDefaultAndRuntimeTag", qaAgent, 100L);
        ReflectionTestUtils.invokeMethod(service, "fillDefaultAndRuntimeTag", thirdPartyPersonalAssistant, 100L);
        ReflectionTestUtils.invokeMethod(service, "fillDefaultAndRuntimeTag", employeeGroup, 100L);

        assertThat(personalAssistant.getTagName()).isEqualTo("digemployee.tag.personal.assistant");
        assertThat(personalAssistant.getIsDefault()).isTrue();
        assertThat(personalAssistant.getCanSetDefault()).isFalse();
        assertThat(qaAgent.getTagName()).isEqualTo("digemployee.tag.agent.qa");
        assertThat(qaAgent.getIsDefault()).isFalse();
        assertThat(qaAgent.getCanSetDefault()).isTrue();
        assertThat(thirdPartyPersonalAssistant.getTagName()).isEqualTo("digemployee.tag.third.party");
        assertThat(employeeGroup.getTagName()).isEqualTo("digemployee.tag.agent.group");
        assertThat(employeeGroup.getCanSetDefault()).isTrue();
    }

    @Test
    void sidebarAndMentionQueriesIncludeDigitalEmployeeGroups() throws Exception {
        String mapperXml;
        String resource = "com/iwhalecloud/byai/manager/mapper/index/IndexMapper.xml";
        try (InputStream inputStream = getClass().getClassLoader().getResourceAsStream(resource)) {
            assertThat(inputStream).as("index mapper resource").isNotNull();
            mapperXml = new String(inputStream.readAllBytes(), StandardCharsets.UTF_8);
        }

        assertThat(selectBody(mapperXml, "selectAuthDigitEmploy"))
            .contains("a.resource_biz_type = 'DIG_EMPLOYEE'")
            .doesNotContain("coalesce(b.agent_type, '') != '017'");
        assertThat(selectBody(mapperXml, "queryMyUsual"))
            .contains("a.resource_biz_type = 'DIG_EMPLOYEE'")
            .doesNotContain("coalesce(b.agent_type, '') != '017'");
        assertThat(selectBody(mapperXml, "queryRecentlyAdded"))
            .contains("a.resource_biz_type = 'DIG_EMPLOYEE'")
            .doesNotContain("coalesce(b.agent_type, '') != '017'");

        // 管理端的普通数字员工列表仍保持分类，不把员工组混入原列表。
        assertThat(selectBody(mapperXml, "queryMyCreated")).contains("coalesce(b.agent_type, '') != '017'");
    }

    private String selectBody(String mapperXml, String statementId) {
        String startTag = "<select id=\"" + statementId + "\"";
        int start = mapperXml.indexOf(startTag);
        assertThat(start).as(statementId + " start").isGreaterThanOrEqualTo(0);
        int end = mapperXml.indexOf("</select>", start);
        assertThat(end).as(statementId + " end").isGreaterThan(start);
        return mapperXml.substring(start, end);
    }

    private DigitEmployMarketExtVo buildDigitEmployee(Long id, String ownerType, String resourceCode, String agentType) {
        DigitEmployMarketExtVo vo = new DigitEmployMarketExtVo();
        vo.setId(id);
        vo.setCreatorId(2L);
        vo.setManUserId("");
        vo.setOwnerType(ownerType);
        vo.setResourceCode(resourceCode);
        vo.setAgentType(agentType);
        return vo;
    }
}
