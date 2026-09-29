package com.iwhalecloud.byai.manager.application.service.digitemploy;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyLong;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.doReturn;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import java.util.ArrayList;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;


import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceArtifactService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;

/**
 * 卡片 0009 · 收口点 ②（运行配置导出）与收口点 ③（同步入口白名单）。
 *
 * <p>T-06 捕获真实序列化的 `jsonContent`（`persistTargetContent` / 开放目录产物 / Redis 主员工 JSON 同源），
 * T-09 断言**副本方案**：导出后 `findDetailsById` 返回的**同一实例**逐字不变。
 */
class DigitalEmployeeSyncExportDisableTest {

    private static final Long EMPLOYEE_ID = 100L;

    private DigitalEmployeeApplicationService service;
    private SsResourceRelDetailService relDetailService;
    private ResourceArtifactStorageService artifactStorageService;

    @BeforeEach
    void setUp() {
        service = org.mockito.Mockito.spy(new DigitalEmployeeApplicationService());
        SsResourceService ssResourceService = mock(SsResourceService.class);
        relDetailService = mock(SsResourceRelDetailService.class);
        SsResExtDigEmployeeService extDigEmployeeService = mock(SsResExtDigEmployeeService.class);
        artifactStorageService = mock(ResourceArtifactStorageService.class);
        SsResourceArtifactService artifactService = mock(SsResourceArtifactService.class);
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResourceRelDetailService", relDetailService);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", extDigEmployeeService);
        ReflectionTestUtils.setField(service, "resourceArtifactStorageService", artifactStorageService);
        ReflectionTestUtils.setField(service, "ssResourceArtifactService", artifactService);
        // 关联资源侧同步在无关联时天然短路，保持用例聚焦在员工侧 JSON。
        when(relDetailService.findByResourceId(anyLong())).thenReturn(new ArrayList<>());
    }

    // --------------------------------------------------------------- T-06

    @Test
    void exportJsonExcludesDisabledRelResources() {
        DigitalEmployeeDetailsDTO details = detailsWithDisabledAndNormal();
        doReturn(details).when(service).findDetailsById(any(EmployeeIdDTO.class));

        boolean synced = service.synOpenClawWorkSpace(EMPLOYEE_ID);

        assertThat(synced).isFalse(); // Redis 同步未启用（属性未注入），与既有行为一致
        String jsonContent = capturedJsonContent();
        // 停用类型不出现在导出的运行配置里；正常类型仍在。
        assertThat(jsonContent).doesNotContain("OBJECT").doesNotContain("999");
        assertThat(jsonContent).contains("MCP").contains("888");
        assertThat(jsonContent).doesNotContain("targetContent");
    }

    // --------------------------------------------------------------- T-09

    @Test
    void findDetailsByIdInstanceIsNotMutatedByExport() {
        DigitalEmployeeDetailsDTO details = detailsWithDisabledAndNormal();
        doReturn(details).when(service).findDetailsById(any(EmployeeIdDTO.class));

        service.synOpenClawWorkSpace(EMPLOYEE_ID);

        // 导出走副本：同一实例仍含四类关联，且 targetContent 仍非空（内部形态未被污染）。
        assertThat(details.getRelResourceList()).extracting(SsResourceDTO::getResourceBizType)
            .containsExactlyInAnyOrder("MCP", "OBJECT");
        assertThat(details.getTargetContent()).isNotNull();
    }

    // --------------------------------------------------------------- T-07

    @Test
    void supportedRelatedResourceBizTypeExcludesDisabledTypes() {
        for (String disabled : List.of("OBJECT", "object", " OBJECT ", "VIEW", "view", "ONTOLOGY_BASE",
            "ontology_base", "SCENE", "Scene")) {
            assertThat(isSupported(disabled)).as("disabled=%s", disabled).isFalse();
        }
        for (String normal : List.of("TOOLKIT", "MCP", "AGENT", "SKILL", "KG_DOC", "KG_DB", "KG_QA", "KG_TERM")) {
            assertThat(isSupported(normal)).as("normal=%s", normal).isTrue();
        }
        // 未传/空类型不参与同步（既有语义：非白名单 ⇒ false）。
        assertThat(isSupported(null)).isFalse();
        assertThat(isSupported("")).isFalse();
    }

    // ------------------------------------------------------------- 基础设施

    private boolean isSupported(String resourceBizType) {
        Boolean result = ReflectionTestUtils.invokeMethod(service, "isSupportedRelatedResourceBizType",
            resourceBizType);
        return Boolean.TRUE.equals(result);
    }

    private String capturedJsonContent() {
        ArgumentCaptor<String> jsonCaptor = ArgumentCaptor.forClass(String.class);
        org.mockito.Mockito.verify(artifactStorageService).syncResourceJsonByBizType(jsonCaptor.capture(),
            anyString(), anyLong());
        return jsonCaptor.getValue();
    }

    private static DigitalEmployeeDetailsDTO detailsWithDisabledAndNormal() {
        DigitalEmployeeDetailsDTO details = new DigitalEmployeeDetailsDTO();
        details.setResourceId(EMPLOYEE_ID);
        details.setResourceName("测试数字员工");
        details.setTargetContent("{\"relTools\":[]}");
        List<SsResourceDTO> relResources = new ArrayList<>();
        relResources.add(rel("888", "MCP"));
        relResources.add(rel("999", "OBJECT"));
        details.setRelResourceList(relResources);
        return details;
    }

    private static SsResourceDTO rel(String resourceId, String resourceBizType) {
        SsResourceDTO dto = new SsResourceDTO();
        dto.setResourceId(Long.valueOf(resourceId));
        dto.setResourceBizType(resourceBizType);
        dto.setResourceName("R-" + resourceId);
        return dto;
    }
}
