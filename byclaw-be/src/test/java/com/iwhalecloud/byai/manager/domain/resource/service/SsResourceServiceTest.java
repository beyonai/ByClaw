package com.iwhalecloud.byai.manager.domain.resource.service;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

class SsResourceServiceTest {

    private SequenceService sequenceService;
    private SsResourceMapper ssResourceMapper;
    private SsResourceService service;

    @BeforeEach
    void setUp() {
        sequenceService = mock(SequenceService.class);
        ssResourceMapper = mock(SsResourceMapper.class);

        service = new SsResourceService();
        ReflectionTestUtils.setField(service, "sequenceService", sequenceService);
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeMapper", mock(SsResExtDigEmployeeMapper.class));

        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(11L);
        loginInfo.setEnterpriseId(22L);
        CurrentUserHolder.setLoginInfo(loginInfo);
    }

    @AfterEach
    void tearDown() {
        CurrentUserHolder.setLoginInfo(null);
    }

    @Test
    void saveResource_fillsUpdateAuditFieldsForNewResource() {
        when(sequenceService.nextVal()).thenReturn(1001L);
        when(ssResourceMapper.insert(any(SsResource.class))).thenReturn(1);

        SsResource resource = new SsResource();
        resource.setResourceName("测试数字员工");
        resource.setResourceBizType("DIG_EMPLOYEE");

        service.saveResource(resource);

        ArgumentCaptor<SsResource> captor = ArgumentCaptor.forClass(SsResource.class);
        verify(ssResourceMapper).insert(captor.capture());

        SsResource saved = captor.getValue();
        assertThat(saved.getCreateTime()).isNotNull();
        assertThat(saved.getUpdateTime()).isEqualTo(saved.getCreateTime());
        assertThat(saved.getCreateBy()).isEqualTo(11L);
        assertThat(saved.getUpdateBy()).isEqualTo(saved.getCreateBy());
    }
}
