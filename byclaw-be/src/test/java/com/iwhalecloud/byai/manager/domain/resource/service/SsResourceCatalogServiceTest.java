package com.iwhalecloud.byai.manager.domain.resource.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogTreeVO;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceCatalogMapper;

/**
 * 入口 13 {@code /catalog/queryResourceCatalogTree} 的停用类型改造单测。
 *
 * <p>覆盖 AC-013：资源节点类型不再硬编码 {@code OBJECT}，而由统一规则派生（四类全部停用 ⇒ 空列表），
 * 目录层级与排序能力保留。
 */
@ExtendWith(MockitoExtension.class)
class SsResourceCatalogServiceTest {

    @Mock
    private SsResourceCatalogMapper ssResourceCatalogMapper;

    @Test
    void catalogTreePassesEmptyEnabledTypesWhenObjectDisabled() {
        when(ssResourceCatalogMapper.queryResourceCatalogTree(eq(6), any())).thenReturn(List.of());

        SsResourceCatalogService service = new SsResourceCatalogService();
        ReflectionTestUtils.setField(service, "ssResourceCatalogMapper", ssResourceCatalogMapper);
        service.queryResourceCatalogTree(6);

        @SuppressWarnings("unchecked")
        ArgumentCaptor<List<String>> captor = ArgumentCaptor.forClass(List.class);
        org.mockito.Mockito.verify(ssResourceCatalogMapper).queryResourceCatalogTree(eq(6), captor.capture());
        // OBJECT 属停用类型 ⇒ 规则派生的可用节点类型为空，不再挂任何资源节点。
        assertThat(captor.getValue()).isEmpty();
    }

    @Test
    void catalogTreeKeepsCatalogNodesWithoutResourceNodes() {
        when(ssResourceCatalogMapper.queryResourceCatalogTree(eq(6), any())).thenReturn(List.of(
            catalog(10L, "根目录", -1L, "10", 1),
            catalog(11L, "子目录", 10L, "10.11", 2)
        ));

        SsResourceCatalogService service = new SsResourceCatalogService();
        ReflectionTestUtils.setField(service, "ssResourceCatalogMapper", ssResourceCatalogMapper);
        List<ResourceCatalogTreeVO> tree = service.queryResourceCatalogTree(6);

        assertThat(tree).hasSize(1);
        assertThat(tree.get(0).getCatalogId()).isEqualTo(10L);
        assertThat(tree.get(0).getChildren()).hasSize(1);
        assertThat(tree.get(0).getChildren().get(0).getCatalogId()).isEqualTo(11L);
        // 目录节点不带资源节点信息。
        assertThat(tree.get(0).getRelResourceId()).isNull();
        assertThat(tree.get(0).getChildren().get(0).getRelResourceId()).isNull();
    }

    private static ResourceCatalogTreeVO catalog(Long catalogId, String catalogName, Long pCatalogId,
        String catalogPath, Integer orderIndex) {
        ResourceCatalogTreeVO node = new ResourceCatalogTreeVO();
        node.setCatalogId(catalogId);
        node.setCatalogName(catalogName);
        node.setPCatalogId(pCatalogId);
        node.setCatalogPath(catalogPath);
        node.setOrderIndex(orderIndex);
        node.setCatalogType(6);
        return node;
    }
}
