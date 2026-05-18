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
        List<DigitEmployMarketExtVo> discoverList = List.of(superAssistant, dataAgent);

        when(indexService.discover(any(DiscoverQo.class))).thenReturn(discoverList);
        when(indexService.findManPrivVo(any())).thenReturn(Collections.emptyMap());

        service.discover(new DiscoverQo());

        assertThat(superAssistant.getTagName()).isEqualTo("digemployee.tag.super.assistant");
        assertThat(dataAgent.getTagName()).isEqualTo("digemployee.tag.agent.data");
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

        ReflectionTestUtils.invokeMethod(service, "fillDefaultAndRuntimeTag", personalAssistant, 100L);
        ReflectionTestUtils.invokeMethod(service, "fillDefaultAndRuntimeTag", qaAgent, 100L);

        assertThat(personalAssistant.getTagName()).isEqualTo("digemployee.tag.personal.assistant");
        assertThat(personalAssistant.getIsDefault()).isTrue();
        assertThat(personalAssistant.getCanSetDefault()).isFalse();
        assertThat(qaAgent.getTagName()).isEqualTo("digemployee.tag.agent.qa");
        assertThat(qaAgent.getIsDefault()).isFalse();
        assertThat(qaAgent.getCanSetDefault()).isTrue();
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
