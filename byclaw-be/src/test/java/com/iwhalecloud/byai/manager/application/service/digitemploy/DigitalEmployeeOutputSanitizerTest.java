package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.Test;

import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;

/**
 * 员工详情对外输出净化器的纯函数单测。
 *
 * <p>覆盖 AC-012：输出投影清空内部 {@code targetContent}，并剔除四类停用类型关联资源；
 * {@code null} / 空输入安全。
 */
class DigitalEmployeeOutputSanitizerTest {

    @Test
    void sanitizeForOutputClearsTargetContentAndFiltersDisabledRelResources() {
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setTargetContent("{\"relTools\":[{\"id\":1}]}");
        details.setRelResourceList(new ArrayList<>(List.of(
            resourceDto(1L, "OBJECT"),
            resourceDto(2L, "KG_DOC"),
            resourceDto(3L, "ontology_base"),
            resourceDto(4L, "SKILL"),
            resourceDto(5L, null)
        )));

        DigitalEmployeeOutputSanitizer.sanitizeForOutput(details);

        assertThat(details.getTargetContent()).isNull();
        assertThat(details.getRelResourceList()).extracting(SsResourceDTO::getResourceBizType)
            .containsExactly("KG_DOC", "SKILL", null);
    }

    @Test
    void sanitizeForOutputIsNullSafe() {
        DigitalEmployeeOutputSanitizer.sanitizeForOutput(null);

        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        DigitalEmployeeOutputSanitizer.sanitizeForOutput(details);
        assertThat(details.getTargetContent()).isNull();
        assertThat(details.getRelResourceList()).isNull();
    }

    @Test
    void filterRelResourcesKeepsNormalTypesAndEmptyInput() {
        assertThat(DigitalEmployeeOutputSanitizer.filterRelResources(null)).isNull();
        assertThat(DigitalEmployeeOutputSanitizer.filterRelResources(List.of())).isEmpty();
        assertThat(DigitalEmployeeOutputSanitizer.filterRelResources(List.of(
            resourceDto(1L, "VIEW"), resourceDto(2L, "TOOLKIT"))))
            .extracting(SsResourceDTO::getResourceBizType)
            .containsExactly("TOOLKIT");
    }

    private static SsResourceDTO resourceDto(Long resourceId, String resourceBizType) {
        SsResourceDTO dto = new SsResourceDTO();
        dto.setResourceId(resourceId);
        dto.setResourceBizType(resourceBizType);
        return dto;
    }
}
