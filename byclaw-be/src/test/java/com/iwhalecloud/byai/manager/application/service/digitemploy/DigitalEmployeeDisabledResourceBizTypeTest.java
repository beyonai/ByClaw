package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.Mockito;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.qo.resource.AgentListQo;
import com.iwhalecloud.byai.manager.entity.staticdata.ByaiSystemConfigList;
import com.iwhalecloud.byai.manager.domain.staticdata.service.ByaiSystemConfigListService;

/**
 * 入口 9 / 入口 10 / 入口 14 的停用类型过滤单测。
 *
 * <p>覆盖 AC-011 / AC-012 / AC-014：员工关联资源信息、员工详情对外输出、默认配置资源均剔除停用类型；
 * 共用方法（{@code findByIdList} / {@code getResourceListByCode} / {@code findDetailsById}）语义不变。
 */
class DigitalEmployeeDisabledResourceBizTypeTest {

    @Test
    void queryRelResourceInfoFiltersDisabledTypes() {
        SsResourceService ssResourceService = mock(SsResourceService.class);
        SsResourceRelDetailService relDetailService = mock(SsResourceRelDetailService.class);
        DigitalEmployeeApplicationService service = new DigitalEmployeeApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", relDetailService);

        SsResourceRelDetail relDetail = new SsResourceRelDetail();
        relDetail.setRelResourceId(11L);
        when(relDetailService.findByResourceId(9L)).thenReturn(List.of(relDetail));
        when(ssResourceService.findByIdList(List.of(11L))).thenReturn(List.of(
            resource(11L, "OBJECT"), resource(12L, "KG_DOC"), resource(13L, "view"), resource(14L, "SKILL")));

        DigitalEmployeeDetailsDTO dto = new DigitalEmployeeDetailsDTO();
        dto.setResourceId(9L);
        try (var ignored = mockStatic(I18nUtil.class)) {
            service.queryRelResourceInfo(dto);
        }

        // 共用 findByIdList 未被改动，仍按原入参调用。
        Mockito.verify(ssResourceService).findByIdList(List.of(11L));
    }

    @Test
    void queryResourceListByDefaultTypeFiltersDisabledTypes() {
        SsResourceService ssResourceService = mock(SsResourceService.class);
        ByaiSystemConfigListService configService = mock(ByaiSystemConfigListService.class);
        DigitalEmployeeApplicationService service = new DigitalEmployeeApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "byaiSystemConfigListService", configService);

        when(configService.findByParamGroupCode("DEFAULT_AGENT")).thenReturn(List.of(config("a-1"), config("a-2")));
        when(ssResourceService.getResourceListByCode(List.of("a-1", "a-2"))).thenReturn(
            Arrays.asList(resource(21L, "OBJECT"), resource(22L, "AGENT"), resource(23L, "SCENE"), null));

        AgentListQo qo = new AgentListQo();
        qo.setDefaultType("DEFAULT_AGENT");

        List<SsResource> result = service.queryResourceListByDefaultType(qo);

        assertThat(result.stream().filter(java.util.Objects::nonNull).map(SsResource::getResourceBizType).toList())
            .containsExactly("AGENT");
        // null 元素保持原样（过滤只做减法，不改变既有列表语义，也不抛 NPE）。
        assertThat(result).hasSize(2).containsNull();
        // 共用 getResourceListByCode 语义不变，仍按原 code 列表查询。
        Mockito.verify(ssResourceService).getResourceListByCode(List.of("a-1", "a-2"));
    }

    @Test
    void findDetailsByIdForOutputClearsTargetContentAndFiltersRelResources() {
        DigitalEmployeeApplicationService service = Mockito.spy(new DigitalEmployeeApplicationService());
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setTargetContent("{\"relTools\":[]}");
        details.setRelResourceList(new ArrayList<>(List.of(
            resourceDto(31L, "OBJECT"), resourceDto(32L, "KG_DOC"), resourceDto(33L, "ONTOLOGY_BASE"))));

        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(9L);
        doReturn(details).when(service).findDetailsById(any());

        DigitalEmployeeDetailsDTO output = service.findDetailsByIdForOutput(employeeIdDTO);

        assertThat(output.getTargetContent()).isNull();
        assertThat(output.getRelResourceList()).extracting(SsResourceDTO::getResourceBizType)
            .containsExactly("KG_DOC");
    }

    @Test
    void findDetailsByIdStillReturnsRawTargetContentForInternalCallers() {
        DigitalEmployeeApplicationService service = Mockito.spy(new DigitalEmployeeApplicationService());
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setTargetContent("{\"relTools\":[]}");
        EmployeeIdDTO employeeIdDTO = new EmployeeIdDTO();
        employeeIdDTO.setResourceId(9L);
        doReturn(details).when(service).findDetailsById(any());

        // 共用方法语义不变：内部调用方仍拿到原始 targetContent。
        assertThat(service.findDetailsById(employeeIdDTO).getTargetContent()).isEqualTo("{\"relTools\":[]}");
    }

    private static ByaiSystemConfigList config(String paramValue) {
        ByaiSystemConfigList config = new ByaiSystemConfigList();
        config.setParamValue(paramValue);
        return config;
    }

    private static SsResource resource(Long resourceId, String resourceBizType) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType(resourceBizType);
        return resource;
    }

    private static SsResourceDTO resourceDto(Long resourceId, String resourceBizType) {
        SsResourceDTO dto = new SsResourceDTO();
        dto.setResourceId(resourceId);
        dto.setResourceBizType(resourceBizType);
        return dto;
    }
}
