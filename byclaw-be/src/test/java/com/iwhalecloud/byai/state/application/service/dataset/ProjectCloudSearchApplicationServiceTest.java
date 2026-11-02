package com.iwhalecloud.byai.state.application.service.dataset;

import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.ArgumentCaptor;
import org.mockito.Mock;
import org.mockito.MockedStatic;
import org.mockito.junit.jupiter.MockitoExtension;
import org.springframework.test.util.ReflectionTestUtils;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchItem;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeMetadataSearchResult;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.resource.KnowledgeMetadataSearchRequest;
import com.iwhalecloud.byai.manager.dto.resource.ProjectCloudSearchRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mockStatic;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.verifyNoInteractions;
import static org.mockito.Mockito.when;

/** 工作组云盘过滤与分页契约回归，创建于 2026-10-26，作者 Codex。 */
@ExtendWith(MockitoExtension.class)
class ProjectCloudSearchApplicationServiceTest {

    @Mock
    private DatasetApplicationService datasets;

    @Mock
    private SsResourceService resources;

    @Mock
    private AuthApplicationService authorization;

    private ProjectCloudSearchApplicationService service;

    @BeforeEach
    void setUp() {
        service = new ProjectCloudSearchApplicationService();
        ReflectionTestUtils.setField(service, "datasets", datasets);
        ReflectionTestUtils.setField(service, "resources", resources);
        ReflectionTestUtils.setField(service, "authorization", authorization);
    }

    @Test
    void combinesFiltersBeforePagingAndPreservesDirectoryTypeTotalAndOrder() throws Exception {
        allowCloud();
        ProjectCloudSearchRequest request = request();
        request.setKeyword("  方案%_!  ");
        request.setFileType("PDF");
        request.setCreatorId(77L);
        request.setCreatedFrom("2026-10-20T00:00:00+08:00");
        request.setCreatedBefore("2026-10-27T00:00:00+08:00");
        request.setPageNum(3);
        ShareBfmUser creator = new ShareBfmUser();
        creator.setUserCode("account-77");
        creator.setUserName("张三");
        KnowledgeMetadataSearchItem item = new ObjectMapper().readValue(
            "{\"filePath\":\"/资料\",\"type\":\"directory\",\"metadata\":{}}", KnowledgeMetadataSearchItem.class);
        item.setMetadata(Map.of("userCode", Map.of("valueType", "string", "value", "account-77")));
        KnowledgeMetadataSearchResult page = new KnowledgeMetadataSearchResult();
        page.setData(List.of(item));
        page.setTotal(41L);
        page.setPageNum(3);
        page.setPageSize(20);
        when(datasets.searchKnowledgeMetadata(any())).thenReturn(page);

        try (MockedStatic<ShareCacheUtil> cache = mockStatic(ShareCacheUtil.class)) {
            cache.when(() -> ShareCacheUtil.getShareBfmUser(77L)).thenReturn(creator);
            cache.when(() -> ShareCacheUtil.getShareBfmUser("account-77")).thenReturn(creator);
            assertThat(service.search(request)).isSameAs(page);
        }
        ArgumentCaptor<KnowledgeMetadataSearchRequest> query = ArgumentCaptor.forClass(KnowledgeMetadataSearchRequest.class);
        verify(datasets).searchKnowledgeMetadata(query.capture());
        assertThat(query.getValue().getResourceIdList()).containsExactly(100L);
        assertThat(query.getValue().getPageNum()).isEqualTo(3);
        assertThat(query.getValue().getPageSize()).isEqualTo(20);
        assertThat(query.getValue().getWhere()).isEqualTo(Map.of("and", List.of(
            Map.of("not", leaf("wildcard", "filePath", "*/group-task-results/*")),
            Map.of("not", leaf("wildcard", "filePath", "*/group-task-results")),
            leaf("wildcard", "fileName", "*方案%_!*"),
            leaf("eq", "fileType", "pdf"),
            leaf("eq", "userCode", "account-77"),
            leaf("gte", "createdAt", "2026-10-20T00:00+08:00"),
            leaf("lt", "createdAt", "2026-10-27T00:00+08:00")
        )));
        assertThat(page.getTotal()).isEqualTo(41L);
        assertThat(page.getData()).containsExactly(item);
        assertThat(item.getType()).isEqualTo("directory");
        assertThat(item.getCreateStaffName()).isEqualTo("张三");
    }

    @Test
    void rejectsInaccessibleOrNonCloudResourceBeforeQueryingBykc() {
        SsResource resource = new SsResource();
        resource.setResourceBizType("KG_CLOUD");
        when(resources.findById(100L)).thenReturn(resource);
        when(authorization.hasResourceAccessPermission(resource)).thenReturn(false);
        assertThatThrownBy(() -> service.search(request())).isInstanceOf(BaseException.class);
        resource.setResourceBizType("KG_DOC");
        assertThatThrownBy(() -> service.search(request())).isInstanceOf(BaseException.class);
        verifyNoInteractions(datasets);
    }

    @Test
    void rejectsInvalidOrUnzonedDatesAndMissingCreatorRatherThanDroppingFilters() {
        allowCloud();
        ProjectCloudSearchRequest request = request();
        request.setCreatedFrom("2026-10-26T00:00:00");
        request.setCreatedBefore("2026-10-27T00:00:00+08:00");
        assertThatThrownBy(() -> service.search(request)).isInstanceOf(BaseException.class);
        request.setCreatedFrom("2026-10-28T00:00:00+08:00");
        assertThatThrownBy(() -> service.search(request)).isInstanceOf(BaseException.class);
        request.setCreatedFrom(null);
        assertThatThrownBy(() -> service.search(request)).isInstanceOf(BaseException.class);
        request.setCreatedBefore(null);
        request.setCreatorId(77L);
        try (MockedStatic<ShareCacheUtil> cache = mockStatic(ShareCacheUtil.class)) {
            cache.when(() -> ShareCacheUtil.getShareBfmUser(77L)).thenReturn(new ShareBfmUser());
            assertThatThrownBy(() -> service.search(request)).isInstanceOf(BaseException.class);
        }
        verifyNoInteractions(datasets);
    }

    @Test
    void historicalFilesWithoutCreatorRemainVisibleAndEmptyPageKeepsTotal() {
        allowCloud();
        KnowledgeMetadataSearchItem item = new KnowledgeMetadataSearchItem();
        item.setType("file");
        item.setFilePath("/old.txt");
        KnowledgeMetadataSearchResult page = new KnowledgeMetadataSearchResult();
        page.setData(List.of(item));
        page.setTotal(1L);
        when(datasets.searchKnowledgeMetadata(any())).thenReturn(page);
        assertThat(service.search(request()).getData()).containsExactly(item);
        assertThat(item.getCreateStaffName()).isNull();
        page.setData(List.of());
        page.setTotal(0L);
        assertThat(service.search(request()).getTotal()).isZero();
    }

    private void allowCloud() {
        SsResource resource = new SsResource();
        resource.setResourceBizType("KG_CLOUD");
        when(resources.findById(100L)).thenReturn(resource);
        when(authorization.hasResourceAccessPermission(resource)).thenReturn(true);
    }

    private ProjectCloudSearchRequest request() {
        ProjectCloudSearchRequest request = new ProjectCloudSearchRequest();
        request.setResourceId(100L);
        return request;
    }

    private Map<String, Object> leaf(String operator, String fieldName, Object value) {
        return Map.of(operator, Map.of("fieldName", fieldName, "value", value));
    }
}
