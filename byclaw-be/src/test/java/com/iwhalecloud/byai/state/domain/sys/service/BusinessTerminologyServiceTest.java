package com.iwhalecloud.byai.state.domain.sys.service;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

class BusinessTerminologyServiceTest {

    private ByaiSystemConfigService systemConfigService;
    private BusinessTerminologyService terminologyService;

    @BeforeEach
    void setUp() {
        systemConfigService = mock(ByaiSystemConfigService.class);
        terminologyService = new BusinessTerminologyService();
        ReflectionTestUtils.setField(terminologyService, "systemConfigService", systemConfigService);
    }

    @Test
    void replaceDigitalEmployeeTerms_usesConfiguredChineseAndEnglishTerms() {
        when(systemConfigService.getDcSystemConfigValueByCode(BusinessTerminologyService.CONFIG_CODE))
            .thenReturn("{\"zh-CN\":{\"singular\":\"专家\",\"plural\":\"专家\",\"entry\":\"专家\","
                + "\"market\":\"专家市场\"},\"en-US\":{\"singular\":\"Expert\",\"plural\":\"Experts\","
                + "\"entry\":\"Experts\",\"market\":\"Expert Marketplace\"}}");

        assertThat(terminologyService.replaceDigitalEmployeeTerms(
            "数字员工可在员工市场使用；Digital Employees include each Digital Employee. "
                + "Create a Digital Employee. A digital employee is ready."))
                .isEqualTo("专家可在专家市场使用；Experts include each Expert. "
                    + "Create an Expert. An expert is ready.");
    }

    @Test
    void replaceDigitalEmployeeTerms_preservesRealEmployeeWordingAndFallsBackForInvalidConfig() {
        when(systemConfigService.getDcSystemConfigValueByCode(BusinessTerminologyService.CONFIG_CODE))
            .thenReturn("not-json");

        assertThat(terminologyService.replaceDigitalEmployeeTerms("全公司所有员工可见，数字员工可调用。"))
            .isEqualTo("全公司所有员工可见，数字员工可调用。");
    }
}
