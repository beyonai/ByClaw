package com.iwhalecloud.byai.manager.application.service.staticdata;

import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;
import com.iwhalecloud.byai.manager.domain.staticdata.service.SystemConfigService;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfig;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.InjectMocks;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

@ExtendWith(MockitoExtension.class)
class StaticDataQueryApplicationServiceTest {

    @Mock
    private SystemConfigService systemConfigService;

    @Mock
    private ByaiSystemConfigListService byaiSystemConfigListService;

    @InjectMocks
    private StaticDataQueryApplicationService applicationService;

    @Test
    void getDcSystemConfig_managerMenuReadsLatestDatabaseValue() {
        ByaiSystemConfig config = new ByaiSystemConfig();
        config.setParamCode("SYSTEM_BACKEND_MENU_MANAGE");
        when(systemConfigService.findDbAndRefreshCacheByParamCode("SYSTEM_BACKEND_MENU_MANAGE"))
            .thenReturn(config);

        assertThat(applicationService.getDcSystemConfig("SYSTEM_BACKEND_MENU_MANAGE")).isSameAs(config);
        verify(systemConfigService).findDbAndRefreshCacheByParamCode("SYSTEM_BACKEND_MENU_MANAGE");
        verifyNoInteractions(byaiSystemConfigListService);
    }

    @Test
    void getDcSystemConfig_otherConfigKeepsCacheFirstLookup() {
        ByaiSystemConfig config = new ByaiSystemConfig();
        config.setParamCode("OTHER_CONFIG");
        when(systemConfigService.findCacheOrDbByParamCode("OTHER_CONFIG")).thenReturn(config);

        assertThat(applicationService.getDcSystemConfig("OTHER_CONFIG")).isSameAs(config);
        verify(systemConfigService).findCacheOrDbByParamCode("OTHER_CONFIG");
        verifyNoInteractions(byaiSystemConfigListService);
    }
}
