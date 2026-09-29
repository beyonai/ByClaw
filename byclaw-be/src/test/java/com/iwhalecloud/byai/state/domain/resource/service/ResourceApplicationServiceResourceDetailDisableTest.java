package com.iwhalecloud.byai.state.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.anyCollection;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import java.util.HashMap;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.resource.qo.ResourceDetailQo;
import com.iwhalecloud.byai.state.domain.resource.vo.ResourceDetailVo;

/**
 * 入口 6 / 入口 7 的资源详情停用判定单测。
 *
 * <p>覆盖 AC-010：按 {@code resourceId} 与 {@code resourceCode} 两条路径请求停用类型时都不返回详情内容，
 * 且与"资源不存在"完全同形（不新增可区分信息）；正常类型详情字段与基线一致。
 */
@ExtendWith(MockitoExtension.class)
class ResourceApplicationServiceResourceDetailDisableTest {

    @Mock
    private SsResourceService ssResourceService;

    @Mock
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Mock
    private AuthApplicationService authApplicationService;

    @Mock
    private SandboxService sandboxService;

    private ResourceApplicationService service;

    @BeforeEach
    void setUp() {
        service = new ResourceApplicationService();
        ReflectionTestUtils.setField(service, "ssResourceService", ssResourceService);
        ReflectionTestUtils.setField(service, "ssResExtDigEmployeeService", ssResExtDigEmployeeService);
        ReflectionTestUtils.setField(service, "authApplicationService", authApplicationService);
        ReflectionTestUtils.setField(service, "sandboxService", sandboxService);
    }

    @Test
    void queryResourceDetailRejectsDisabledTypeByResourceId() {
        when(ssResourceService.findByIdOrCode(200L, null)).thenReturn(resource(200L, "OBJECT", "对象示例"));

        assertThat(service.queryResourceDetail(detailQo(200L, null))).isNull();
        // 停用类型不得继续走权限查询（与"不存在"路径一致，不产生额外可观察差异）。
        verify(authApplicationService, never()).queryResourceOperationPermissionsBatch(anyCollection());
    }

    @Test
    void queryResourceDetailRejectsDisabledTypeByResourceCode() {
        when(ssResourceService.findByIdOrCode(null, "OBJ_CODE")).thenReturn(resource(201L, "VIEW", "视图示例"));

        assertThat(service.queryResourceDetail(detailQo(null, "OBJ_CODE"))).isNull();
        verify(authApplicationService, never()).queryResourceOperationPermissionsBatch(anyCollection());
    }

    @Test
    void queryResourceDetailTreatsMissingResourceTheSameWay() {
        when(ssResourceService.findByIdOrCode(202L, null)).thenReturn(null);

        assertThat(service.queryResourceDetail(detailQo(202L, null))).isNull();
    }

    @Test
    void keepsNormalTypeDetailFieldsUnchanged() {
        when(ssResourceService.findByIdOrCode(300L, null)).thenReturn(resource(300L, "KG_DOC", "对象视图本体场景说明"));
        Map<Long, ResourceOperationPermissionsVo> permissions = new HashMap<>();
        permissions.put(300L, null);
        when(authApplicationService.queryResourceOperationPermissionsBatch(anyCollection()))
            .thenReturn(permissions);

        ResourceDetailVo detail = service.queryResourceDetail(detailQo(300L, null));

        // 名称含「对象/视图/本体/场景」关键词但类型正常 ⇒ 仍正常返回（禁止关键词过滤）。
        assertThat(detail).isNotNull();
        assertThat(detail.getResourceId()).isEqualTo(300L);
        assertThat(detail.getResourceBizType()).isEqualTo("KG_DOC");
        assertThat(detail.getResourceName()).isEqualTo("对象视图本体场景说明");
        verify(authApplicationService).queryResourceOperationPermissionsBatch(List.of(300L));
    }

    private static ResourceDetailQo detailQo(Long resourceId, String resourceCode) {
        ResourceDetailQo qo = new ResourceDetailQo();
        qo.setResourceId(resourceId);
        qo.setResourceCode(resourceCode);
        return qo;
    }

    private static SsResource resource(Long resourceId, String resourceBizType, String resourceName) {
        SsResource resource = new SsResource();
        resource.setResourceId(resourceId);
        resource.setResourceBizType(resourceBizType);
        resource.setResourceName(resourceName);
        return resource;
    }
}
