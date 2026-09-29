package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

import com.baomidou.mybatisplus.core.conditions.AbstractWrapper;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.resource.ResourceQo;

/**
 * 入口 5 {@code /open/api/v1/getUserAuthResource} 的停用类型排除单测。
 *
 * <p>覆盖 AC-009：{@code selectResourceByQo} 无条件排除四类停用类型（未传类型时同样生效），
 * 且保留 {@code resource_biz_type} 为 null 的历史行；正常类型与授权过滤条件不变。
 */
class SsResourceServiceDisabledBizTypeTest {

    private SsResourceMapper ssResourceMapper;
    private SsResourceService service;

    @BeforeEach
    void setUp() {
        ssResourceMapper = org.mockito.Mockito.mock(SsResourceMapper.class);
        service = new SsResourceService();
        ReflectionTestUtils.setField(service, "ssResourceMapper", ssResourceMapper);
        when(ssResourceMapper.selectPage(any(), any())).thenReturn(new Page<>());
    }

    @Test
    void selectResourceByQoAlwaysExcludesDisabledBizTypes() {
        service.selectResourceByQo(new ResourceQo());

        AbstractWrapper<SsResource, ?, ?> wrapper = capturedWrapper();
        String sql = wrapper.getSqlSegment();
        assertThat(sql).contains("resource_biz_type IS NULL").contains("resource_biz_type NOT IN");
        assertThat(wrapper.getParamNameValuePairs().values())
            .contains("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE");
    }

    @Test
    void selectResourceByQoKeepsNormalTypesAndOwnershipFilter() {
        ResourceQo qo = new ResourceQo();
        qo.setResourceBizTypes(List.of("KG_DOC", "OBJECT"));
        qo.setResourceIds(List.of(11L, 12L));
        qo.setKeyword("文档");
        qo.setCreateBy(33L);

        service.selectResourceByQo(qo);

        AbstractWrapper<SsResource, ?, ?> wrapper = capturedWrapper();
        String sql = wrapper.getSqlSegment();
        // 停用类型排除与正常类型白名单、授权 id、关键字、创建人条件并存。
        assertThat(sql).contains("resource_biz_type IN")
            .contains("resource_id IN")
            .contains("resource_name LIKE")
            .contains("create_by =");
        assertThat(wrapper.getParamNameValuePairs().values())
            .contains("KG_DOC", "OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE", 11L, 12L, 33L);
    }

    @SuppressWarnings("unchecked")
    private AbstractWrapper<SsResource, ?, ?> capturedWrapper() {
        ArgumentCaptor<Wrapper<SsResource>> captor = ArgumentCaptor.forClass(Wrapper.class);
        verify(ssResourceMapper).selectPage(any(), captor.capture());
        return (AbstractWrapper<SsResource, ?, ?>) captor.getValue();
    }
}
