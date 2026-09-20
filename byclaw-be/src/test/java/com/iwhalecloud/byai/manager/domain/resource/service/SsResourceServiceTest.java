package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.MybatisConfiguration;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.metadata.TableInfoHelper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.ibatis.builder.MapperBuilderAssistant;
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
        if (TableInfoHelper.getTableInfo(SsResource.class) == null) {
            TableInfoHelper.initTableInfo(new MapperBuilderAssistant(new MybatisConfiguration(), ""), SsResource.class);
        }
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

    @Test
    void findByImportIdentity_filtersBySystemBizTypeAndResourceCode() {
        SsResource expected = new SsResource();
        expected.setResourceId(1002L);
        when(ssResourceMapper.selectOne(any())).thenReturn(expected);

        SsResource actual = service.findByImportIdentity("BYCLAW", "KG_DOC", "824794494620293");

        assertThat(actual).isSameAs(expected);
        @SuppressWarnings("unchecked")
        ArgumentCaptor<QueryWrapper<SsResource>> captor = ArgumentCaptor.forClass(QueryWrapper.class);
        verify(ssResourceMapper).selectOne(captor.capture());
        QueryWrapper<SsResource> query = captor.getValue();
        assertThat(query.getSqlSegment()).contains("system_code", "resource_biz_type", "resource_code");
        assertThat(query.getParamNameValuePairs().values())
            .containsExactlyInAnyOrder("BYCLAW", "KG_DOC", "824794494620293");
    }

    @Test
    void countResource_excludesDeletedRowsWithNumericStatusAndKeepsPersonalScope() {
        when(ssResourceMapper.selectCount(any())).thenReturn(0L);

        assertThat(service.countResource("研发助手", "DIG_EMPLOYEE", "personal", 100L)).isZero();

        @SuppressWarnings("unchecked")
        ArgumentCaptor<LambdaQueryWrapper<SsResource>> captor = ArgumentCaptor.forClass(LambdaQueryWrapper.class);
        verify(ssResourceMapper).selectCount(captor.capture());
        LambdaQueryWrapper<SsResource> query = captor.getValue();
        // 触发参数绑定,防止枚举 DELETE 被作为字符串传给数据库数值列.
        assertThat(query.getSqlSegment()).contains("resource_status <>", "create_by =", "owner_type =",
            "resource_name =", "resource_biz_type =", "resource_id NOT IN");
        assertThat(query.getParamNameValuePairs().values())
            .containsExactlyInAnyOrder(11L, "personal", "研发助手", "DIG_EMPLOYEE", 100L, -1);
    }
}
