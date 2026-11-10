package com.iwhalecloud.byai.manager.domain.resource.service;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDoc;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDocMapper;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.springframework.test.util.ReflectionTestUtils;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;

class DatasetOwnershipMetadataTest {
    @Test
    void markerIsBoundToTheStoredResourceAndExcludedFromRuntimeJson() {
        SsResExtDoc document = new SsResExtDoc();
        document.setResourceId(100L);
        document.setSourceContent(DatasetOwnershipMetadata.markLocal("{\"resourceName\":\"Knowledge\"}", 100L));
        assertThat(DatasetOwnershipMetadata.isLocal(document)).isTrue();
        document.setResourceId(101L);
        assertThat(DatasetOwnershipMetadata.isLocal(document)).isFalse();
        String target = DatasetOwnershipMetadata.applyScope(document.getSourceContent(), "enterprise", 9L);
        assertThat(target).doesNotContain("_byclawKnowledgeOwnership");
        assertThat(JSONObject.parseObject(target).getString("resourceName")).isEqualTo("Knowledge");
        assertThat(JSONObject.parseObject(target).getLong("catalogId")).isEqualTo(9L);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {"not-json", "null", "{}", "{\"_byclawKnowledgeOwnership\":true}"})
    void legacySourceDoesNotAcquireLocalOwnership(String source) {
        SsResExtDoc document = new SsResExtDoc();
        document.setResourceId(100L);
        document.setSourceContent(source);
        assertThat(DatasetOwnershipMetadata.isLocal(document)).isFalse();
    }

    @Test
    void nullMarkerIsRemovedFromUntrustedImportsToo() {
        assertThat(DatasetOwnershipMetadata.stripLocalMarker("{\"_byclawKnowledgeOwnership\":null,\"catalogId\":9}"))
            .doesNotContain("_byclawKnowledgeOwnership");
    }

    @ParameterizedTest
    @ValueSource(booleans = {false, true})
    void localCreationPersistsProvenanceOnlyInSource(boolean withTemplate) {
        SsResExtDocMapper mapper = mock(SsResExtDocMapper.class);
        SsResExtDocService service = new SsResExtDocService();
        ReflectionTestUtils.setField(service, "ssResExtDocMapper", mapper);
        ReflectionTestUtils.setField(service, "qADomainName", "test");
        ReflectionTestUtils.setField(service, "resourceRuntimeInfoResolver", new ResourceRuntimeInfoResolver());
        ReflectionTestUtils.setField(service, "resourceTargetJsonBuilder", new ResourceTargetJsonBuilder());
        SsResExtDoc result = withTemplate
            ? service.createSsResExtDoc(100L, "dataset", "22", "Knowledge", "Description", "personal")
            : service.createSsResExtDoc(100L, "dataset");
        verify(mapper).insert(result);
        assertThat(DatasetOwnershipMetadata.isLocal(result)).isTrue();
        assertThat(result.getTargetContent()).doesNotContain("_byclawKnowledgeOwnership");
    }
}
