package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.doReturn;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;

/**
 * 卡片 0009 · 三种形态的边界（形态 ① 内部完整关联 / 形态 ② 对外返回对象 / 形态 ③ 导出）。
 *
 * <p>本卡**不改**形态 ①②（`0007` 已交付），此处只回归其边界并断言形态 ③ 的导出不会污染形态 ① 的实例。
 */
class DigitalEmployeeDetailFormsTest {

    private DigitalEmployeeApplicationService service;

    @BeforeEach
    void setUp() {
        service = org.mockito.Mockito.spy(new DigitalEmployeeApplicationService());
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService",
            org.mockito.Mockito.mock(com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService.class));
    }

    // --------------------------------------------------------------- T-11

    @Test
    void internalFormKeepsRawTargetContentAndAllRelations() {
        DigitalEmployeeDetailsDTO details = detailsWithDisabledAndNormal();
        doReturn(details).when(service).findDetailsById(any(EmployeeIdDTO.class));

        DigitalEmployeeDetailsDTO internal = service.findDetailsById(new EmployeeIdDTO());

        // 形态 ①：内部完整关联 —— targetContent 原值保留、关联列表含四类。
        assertThat(internal.getTargetContent()).isEqualTo("{\"relTools\":[]}");
        assertThat(internal.getRelResourceList()).extracting(SsResourceDTO::getResourceBizType)
            .containsExactlyInAnyOrder("MCP", "OBJECT");
    }

    @Test
    void outputFormClearsTargetContentAndFiltersDisabledRelations() {
        DigitalEmployeeDetailsDTO details = detailsWithDisabledAndNormal();
        doReturn(details).when(service).findDetailsById(any(EmployeeIdDTO.class));

        DigitalEmployeeDetailsDTO output = service.findDetailsByIdForOutput(new EmployeeIdDTO());

        // 形态 ②：对外输出 —— targetContent 置空、关联列表剔除四类（其余字段不变）。
        assertThat(output.getTargetContent()).isNull();
        assertThat(output.getRelResourceList()).extracting(SsResourceDTO::getResourceBizType)
            .containsExactly("MCP");
        assertThat(output.getResourceName()).isEqualTo("测试数字员工");
    }

    @Test
    void repeatedInternalReadsAreUnaffectedByOutputProjection() {
        // 每次调用返回**新构造**的实例（与生产一致：findDetailsById 每次从库里重新装配 DTO），
        // 因此对外投影对自身返回实例的净化不会影响下一次内部读取。
        org.mockito.Mockito.doAnswer(invocation -> detailsWithDisabledAndNormal())
            .when(service).findDetailsById(any(EmployeeIdDTO.class));

        // 先走对外投影（会剔除四类），再读内部形态 —— 两次调用必须互相独立、内部形态逐字不变。
        service.findDetailsByIdForOutput(new EmployeeIdDTO());
        DigitalEmployeeDetailsDTO internal = service.findDetailsById(new EmployeeIdDTO());

        assertThat(internal.getTargetContent()).isEqualTo("{\"relTools\":[]}");
        assertThat(internal.getRelResourceList()).extracting(SsResourceDTO::getResourceBizType)
            .containsExactlyInAnyOrder("MCP", "OBJECT");
    }

    private static DigitalEmployeeDetailsDTO detailsWithDisabledAndNormal() {
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setResourceId(100L);
        details.setResourceName("测试数字员工");
        details.setTargetContent("{\"relTools\":[]}");
        List<SsResourceDTO> relResources = new ArrayList<>();
        relResources.add(rel(888L, "MCP"));
        relResources.add(rel(999L, "OBJECT"));
        details.setRelResourceList(relResources);
        return details;
    }

    private static SsResourceDTO rel(Long resourceId, String resourceBizType) {
        SsResourceDTO dto = new SsResourceDTO();
        dto.setResourceId(resourceId);
        dto.setResourceBizType(resourceBizType);
        dto.setResourceName("R-" + resourceId);
        return dto;
    }
}
