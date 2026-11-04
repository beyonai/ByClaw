package com.iwhalecloud.byai.state.application.service.dataset;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.feign.client.FeignPythonBuildService;
import com.iwhalecloud.byai.common.feign.response.PythonBuildResponse;
import com.iwhalecloud.byai.common.feign.response.pythonbuild.KnowledgeBaseInfo;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.resource.EnterpriseResourceSyncContext;
import com.iwhalecloud.byai.manager.domain.resource.service.*;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDocMapper;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactPathResolver;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceArtifactStorageService;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceDiscoveryRegistrationService;
import java.nio.charset.StandardCharsets;
import org.junit.jupiter.api.AfterEach;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.ValueSource;
import org.junit.jupiter.params.provider.CsvSource;
import org.mockito.MockedStatic;
import org.springframework.mock.web.MockMultipartFile;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.*;

/** Exercise real creation, editing, import and extension JSON, mocking only I/O and permission decisions. */
class DatasetOwnershipManagementTest extends I18nTestSupport {
    private SsResourceService resources;
    private SsResExtDocMapper documents;
    private AuthApplicationService auth;
    private FeignPythonBuildService python;
    private SsResource stored;
    private SsResExtDoc storedDocument;
    private DatasetApplicationService service;
    private MockedStatic<RedisUtil> redis;

    @BeforeEach
    void setUp() {
        resources = mock(SsResourceService.class);
        documents = mock(SsResExtDocMapper.class);
        auth = mock(AuthApplicationService.class);
        python = mock(FeignPythonBuildService.class);
        when(resources.createResource(any(SsResource.class))).thenAnswer(call -> {
            stored = call.getArgument(0);
            stored.setResourceId(100L);
            if (stored.getSystemCode() == null) stored.setSystemCode("BYAI");
            if (stored.getCreateBy() == null) stored.setCreateBy(88L);
            return stored;
        });
        when(resources.findById(100L)).thenAnswer(call -> stored);
        when(resources.findByIdForUpdate(100L)).thenAnswer(call -> stored);
        when(resources.findByImportIdentity(any(), eq("KG_DOC"), eq("22"))).thenAnswer(call -> stored);
        when(resources.updateResourceEntity(any())).thenAnswer(call -> {
            stored = call.getArgument(0);
            return stored;
        });
        when(auth.hasResourceManagePermission(any())).thenReturn(true);
        when(documents.selectById(100L)).thenAnswer(call -> storedDocument);
        when(documents.insert(any(SsResExtDoc.class))).thenAnswer(call -> {
            storedDocument = call.getArgument(0);
            return 1;
        });
        when(documents.updateById(any(SsResExtDoc.class))).thenAnswer(call -> {
            storedDocument = call.getArgument(0);
            return 1;
        });
        KnowledgeBaseInfo knowledge = new KnowledgeBaseInfo();
        knowledge.setKnCode("22");
        PythonBuildResponse<KnowledgeBaseInfo> response = new PythonBuildResponse<>();
        response.setResultCode("0");
        response.setResultObject(knowledge);
        when(python.createKnowledgeBase(any(), eq(true))).thenReturn(response);
        service = application();
        redis = mockStatic(RedisUtil.class);
    }

    @AfterEach
    void tearDown() {
        redis.close();
    }

    @ParameterizedTest
    @ValueSource(strings = {"personal", "enterprise", "personal_default"})
    void localCreationPersistsOwnershipAcrossReloadAndRepeatedSynchronization(String owner) {
        if ("personal_default".equals(owner)) {
            when(resources.generateAvailableResourceName(any(), eq("KG_DOC"))).thenReturn("Default knowledge");
            service.createDefaultPersonalDataset(88L, "owner", "Owner");
        } else {
            service.createDataset(request(owner, 9L));
        }
        assertThat(DatasetOwnershipMetadata.isLocal(storedDocument)).isTrue();
        Long localCatalog = stored.getCatalogId();
        // Reload persisted JSON into new objects and a fresh service to rule out in-memory provenance.
        stored = JSON.parseObject(JSON.toJSONString(stored), SsResource.class);
        storedDocument = JSON.parseObject(JSON.toJSONString(storedDocument), SsResExtDoc.class);
        service = application();
        String incoming = "enterprise".equals(owner) ? "personal" : "enterprise";
        for (int attempt = 0; attempt < 2; attempt++) {
            service.importDatasetJson(incoming, 77L, imported("BYAI", incoming, false));
            assertThat(stored.getOwnerType()).isEqualTo(owner);
            assertThat(stored.getCatalogId()).isEqualTo(localCatalog);
            assertThat(stored.getResourceName()).isEqualTo("Updated externally");
            assertThat(DatasetOwnershipMetadata.isLocal(storedDocument)).isTrue();
            JSONObject target = JSONObject.parseObject(storedDocument.getTargetContent());
            assertThat(target.getString("ownerType")).isEqualTo(owner);
            assertThat(target.getLong("catalogId")).isEqualTo(localCatalog);
            assertThat(target.getString("domainURL")).isEqualTo("https://example.invalid/updated");
            assertThat(storedDocument.getTargetContent()).doesNotContain("_byclawKnowledgeOwnership");
        }
    }

    @ParameterizedTest
    @CsvSource({"KG_DOC,enterprise", "KG_DB,enterprise", "KG_QA,enterprise", "KG_TERM,enterprise"})
    void synchronizedKnowledgePersistsCreator(String type, String owner) throws Exception {
        when(resources.findByImportIdentity("WHALE_AGENT", type, "22")).thenAnswer(call -> stored);
        JSONObject json = JSONObject.parseObject(new String(imported("WHALE_AGENT", owner, false).getBytes(), StandardCharsets.UTF_8));
        json.put("resourceBizType", type); json.put("createBy", "1168");
        java.util.function.Supplier<Long> importAction = () -> service.importDatasetJson(owner, 0L,
            new MockMultipartFile("file", "knowledge.json", "application/json", json.toJSONString().getBytes(StandardCharsets.UTF_8)));
        EnterpriseResourceSyncContext.execute(false, "WHALE_AGENT", type, "22", importAction);
        assertThat(stored.getCreateBy()).isEqualTo(1168L);
        json.put("createBy", 2268L);
        EnterpriseResourceSyncContext.execute(false, "WHALE_AGENT", type, "22", importAction);
        assertThat(stored.getCreateBy()).isEqualTo(2268L);
        json.put("createBy", null);
        EnterpriseResourceSyncContext.execute(false, "WHALE_AGENT", type, "22", importAction);
        assertThat(stored.getCreateBy()).isEqualTo(2268L);
        json.put("createBy", 88L);
        importAction.get();
        assertThat(stored.getCreateBy()).isEqualTo(2268L);
        when(auth.hasResourceManagePermission(any())).thenReturn(false);
        assertThatThrownBy(() -> EnterpriseResourceSyncContext.execute(false, "WHALE_AGENT", type, "22", importAction))
            .isInstanceOf(IllegalArgumentException.class);
        assertThat(stored.getCreateBy()).isEqualTo(2268L);
    }

    @Test
    void editedLocalCatalogIsPreservedByTheNextSynchronization() {
        service.createDataset(request("enterprise", 9L));
        DatasetDto update = request("enterprise", 12L);
        update.setResourceId(100L);
        service.updateDataset(update);
        assertThat(JSONObject.parseObject(storedDocument.getTargetContent()).getLong("catalogId")).isEqualTo(12L);
        service.importDatasetJson("personal", 77L, imported("BYAI", "personal", false));
        assertThat(stored.getCatalogId()).isEqualTo(12L);
        assertThat(stored.getOwnerType()).isEqualTo("enterprise");
        assertThat(DatasetOwnershipMetadata.isLocal(storedDocument)).isTrue();
    }

    @ParameterizedTest
    @ValueSource(strings = {"personal", "enterprise"})
    void externalWhaleKnowledgeFollowsIncomingScopeAndRejectsForgedProvenance(String owner) {
        service.importDatasetJson(owner, 9L, imported("WHALE_AGENT", owner, true));
        assertThat(stored.getOwnerType()).isEqualTo(owner);
        assertThat(DatasetOwnershipMetadata.isLocal(storedDocument)).isFalse();
        String incoming = "enterprise".equals(owner) ? "personal" : "enterprise";
        service.importDatasetJson(incoming, 77L, imported("WHALE_AGENT", incoming, true));
        assertThat(stored.getOwnerType()).isEqualTo(incoming);
        assertThat(stored.getCatalogId()).isEqualTo(77L);
        assertThat(DatasetOwnershipMetadata.isLocal(storedDocument)).isFalse();
        assertThat(storedDocument.getSourceContent()).doesNotContain("_byclawKnowledgeOwnership");
        assertThat(storedDocument.getTargetContent()).doesNotContain("_byclawKnowledgeOwnership");
    }

    @Test
    void editingUsesThePostLockRecordInsteadOfTheCachedInitialRead() {
        service.createDataset(request("personal", 9L));
        SsResource initialRead = JSON.parseObject(JSON.toJSONString(stored), SsResource.class);
        when(resources.findById(100L)).thenReturn(initialRead);
        // Another editor commits a catalog change before this operation acquires its import lock.
        stored.setCatalogId(12L);
        when(resources.updateResource(eq(100L), any(), any())).thenReturn(initialRead);
        DatasetDto update = request("personal", null);
        update.setResourceId(100L);
        service.updateDataset(update);
        assertThat(stored.getCatalogId()).isEqualTo(12L);
        assertThat(JSONObject.parseObject(storedDocument.getTargetContent()).getLong("catalogId")).isEqualTo(12L);
    }

    @Test
    void localProvenanceDoesNotBypassManagementPermission() {
        service.createDataset(request("personal", 9L));
        when(auth.hasResourceManagePermission(any())).thenReturn(false);
        clearInvocations(resources, documents);
        assertThatThrownBy(() -> service.importDatasetJson("enterprise", 77L, imported("BYAI", "enterprise", false)))
            .isInstanceOf(IllegalArgumentException.class);
        verify(resources, never()).updateResourceEntity(any());
        verify(documents, never()).updateById(any(SsResExtDoc.class));
    }

    @Test
    void localProvenanceDoesNotPermitUpdatingDeletedKnowledge() {
        service.createDataset(request("personal", 9L));
        stored.setResourceStatus(-1);
        clearInvocations(resources, documents);
        assertThatThrownBy(() -> service.importDatasetJson("enterprise", 77L, imported("BYAI", "enterprise", false)))
            .isInstanceOf(IllegalArgumentException.class);
        verify(resources, never()).updateResourceEntity(any());
        verify(documents, never()).updateById(any(SsResExtDoc.class));
    }

    private DatasetApplicationService application() {
        SsResExtDocService extensions = new SsResExtDocService();
        ReflectionTestUtils.setField(extensions, "ssResExtDocMapper", documents);
        ReflectionTestUtils.setField(extensions, "qADomainName", "test");
        ReflectionTestUtils.setField(extensions, "resourceRuntimeInfoResolver", new ResourceRuntimeInfoResolver());
        ReflectionTestUtils.setField(extensions, "resourceTargetJsonBuilder", new ResourceTargetJsonBuilder());
        DatasetApplicationService application = new DatasetApplicationService();
        ReflectionTestUtils.setField(application, "transactionalSelf", application);
        ReflectionTestUtils.setField(application, "datasetSystem", "");
        ReflectionTestUtils.setField(application, "ssResourceService", resources);
        ReflectionTestUtils.setField(application, "ssResExtDocService", extensions);
        ReflectionTestUtils.setField(application, "authApplicationService", auth);
        ReflectionTestUtils.setField(application, "feignPythonBuildService", python);
        ReflectionTestUtils.setField(application, "resourceArtifactStorageService", mock(ResourceArtifactStorageService.class));
        ReflectionTestUtils.setField(application, "ssResourceArtifactService", mock(SsResourceArtifactService.class));
        ReflectionTestUtils.setField(application, "resourceDiscoveryRegistrationService", mock(ResourceDiscoveryRegistrationService.class));
        ReflectionTestUtils.setField(application, "resourceArtifactPathResolver", new ResourceArtifactPathResolver());
        ReflectionTestUtils.setField(application, "resourceRuntimeInfoResolver", new ResourceRuntimeInfoResolver());
        ReflectionTestUtils.setField(application, "resourceTargetJsonBuilder", new ResourceTargetJsonBuilder());
        return application;
    }

    private DatasetDto request(String owner, Long catalog) {
        DatasetDto request = new DatasetDto();
        request.setResourceName("Knowledge");
        request.setResourceDesc("Description");
        request.setOwnerType(owner);
        request.setCatalogId(catalog);
        request.setResourceBizType("KG_DOC");
        request.setType("dataset");
        return request;
    }

    private MockMultipartFile imported(String system, String owner, boolean forgedMarker) {
        JSONObject json = new JSONObject(true);
        json.put("systemCode", system);
        json.put("resourceBizType", "KG_DOC");
        json.put("resourceType", "external");
        json.put("resourceCode", "22");
        json.put("resourceName", "Updated externally");
        json.put("ownerType", owner);
        json.put("catalogId", 77L);
        json.put("domainName", "test");
        json.put("domainURL", "https://example.invalid/updated");
        String content = forgedMarker ? DatasetOwnershipMetadata.markLocal(json.toJSONString(), 100L) : json.toJSONString();
        return new MockMultipartFile("file", "knowledge.json", "application/json", content.getBytes(StandardCharsets.UTF_8));
    }
}
