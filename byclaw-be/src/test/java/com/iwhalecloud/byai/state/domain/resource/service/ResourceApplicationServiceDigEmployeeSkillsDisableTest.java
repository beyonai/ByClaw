package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;

/**
 * 入口 8 {@code /open/api/v1/queryDigEmployeeSkills} 的停用类型过滤单测。
 *
 * <p>覆盖 AC-011：未传 {@code resourceBizType} 时同样剔除停用类型关联资源；正常关联资源与扩展字段完整保留。
 */
@ExtendWith(MockitoExtension.class)
class ResourceApplicationServiceDigEmployeeSkillsDisableTest {

    @Mock
    private SsResourceRelDetailService ssResourceRelDetailService;

    private ResourceApplicationService service;

    @BeforeEach
    void setUp() {
        service = new ResourceApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", ssResourceRelDetailService);
    }

    @Test
    void skillsExcludeDisabledTypesWhenBizTypeNotProvided() {
        when(ssResourceRelDetailService.querySkillsForOpenApi(9L)).thenReturn(List.of(
            skill("KG_DOC", "文档"),
            skill("OBJECT", "旧对象"),
            skill("VIEW", "旧视图"),
            skill("SCENE", "旧场景"),
            skill("ONTOLOGY_BASE", "旧本体"),
            skill("TOOLKIT", "工具集")
        ));

        List<SsResourceRelDetailDTO> skills = service.queryDigEmployeeSkillsForOpenApi(9L, null);

        assertThat(skills).extracting(SsResourceRelDetailDTO::getResourceBizType)
            .containsExactly("KG_DOC", "TOOLKIT");
    }

    @Test
    void skillsExcludeDisabledTypesWhenBizTypeProvided() {
        when(ssResourceRelDetailService.querySkillsForOpenApi(9L)).thenReturn(List.of(
            skill("KG_DOC", "文档"),
            skill("object", "小写旧对象"),
            skill("KG_DB", "数据")
        ));

        assertThat(service.queryDigEmployeeSkillsForOpenApi(9L, "KG_DOC"))
            .extracting(SsResourceRelDetailDTO::getResourceBizType)
            .containsExactly("KG_DOC");
        assertThat(service.queryDigEmployeeSkillsForOpenApi(9L, "OBJECT")).isEmpty();
    }

    @Test
    void keepsNormalSkillsAndExtFields() {
        SsResourceRelDetailDTO doc = skill("KG_DOC", "文档");
        doc.setRelResourceInfo("{\"extDoc\":{\"k\":1}}");
        doc.setResourceCode("doc-1");
        when(ssResourceRelDetailService.querySkillsForOpenApi(9L)).thenReturn(List.of(doc));

        List<SsResourceRelDetailDTO> skills = service.queryDigEmployeeSkillsForOpenApi(9L, null);

        assertThat(skills).hasSize(1);
        assertThat(skills.get(0).getRelResourceInfo()).isEqualTo("{\"extDoc\":{\"k\":1}}");
        assertThat(skills.get(0).getResourceCode()).isEqualTo("doc-1");
    }

    private static SsResourceRelDetailDTO skill(String resourceBizType, String resourceName) {
        SsResourceRelDetailDTO skill = new SsResourceRelDetailDTO();
        skill.setResourceBizType(resourceBizType);
        skill.setResourceName(resourceName);
        return skill;
    }
}
