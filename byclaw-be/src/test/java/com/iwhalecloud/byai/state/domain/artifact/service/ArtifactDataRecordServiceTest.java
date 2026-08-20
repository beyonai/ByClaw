package com.iwhalecloud.byai.state.domain.artifact.service;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactDataRecordMapper;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataCreateRequest;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataRecordDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataUpdateRequest;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactDataRecord;
import java.time.LocalDateTime;
import java.util.Map;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;
import org.springframework.test.util.ReflectionTestUtils;

class ArtifactDataRecordServiceTest {

    private ArtifactDataRecordMapper mapper;
    private ArtifactApplicationService artifactApplicationService;
    private ArtifactDataRecordService service;

    @BeforeEach
    void setUp() {
        mapper = mock(ArtifactDataRecordMapper.class);
        artifactApplicationService = mock(ArtifactApplicationService.class);
        service = new ArtifactDataRecordService(mapper, artifactApplicationService, new ObjectMapper());
        ReflectionTestUtils.setField(service, "maxRecordBytes", 65_536);
    }

    @Test
    void createsPublicRecordWithOpaqueRecordKey() {
        when(mapper.insert(any())).thenReturn(1);
        ArtifactDataCreateRequest request = createRequest(Map.of("title", "Plan trip", "done", false));

        ArtifactDataRecordDto result = service.createPublic("artifact-1", "access-key", request);

        assertThat(result.getRecordKey()).isNotBlank();
        assertThat(result.getCollectionName()).isEqualTo("tasks");
        assertThat(result.getData()).containsEntry("title", "Plan trip").containsEntry("done", false);
        assertThat(result.getVersion()).isEqualTo(1);
        verify(artifactApplicationService).requireCapabilityDataAccessible("artifact-1", "access-key");
        ArgumentCaptor<ArtifactDataRecord> captor = ArgumentCaptor.forClass(ArtifactDataRecord.class);
        verify(mapper).insert(captor.capture());
        assertThat(captor.getValue().getDataJson()).contains("\"title\":\"Plan trip\"")
            .contains("\"done\":false");
    }

    @Test
    void queriesPublicRecordByRecordKey() {
        when(mapper.selectByRecordKey("artifact-1", "record-1")).thenReturn(storedRecord());

        ArtifactDataRecordDto result = service.getPublic("artifact-1", "access-key", "record-1");

        assertThat(result.getRecordKey()).isEqualTo("record-1");
        assertThat(result.getCollectionName()).isEqualTo("tasks");
        assertThat(result.getData()).containsEntry("title", "Plan trip");
        verify(artifactApplicationService).requireCapabilityDataAccessible("artifact-1", "access-key");
    }

    @Test
    void updatesPublicRecordByRecordKeyWithOptimisticVersion() {
        when(mapper.selectByRecordKey("artifact-1", "record-1")).thenReturn(storedRecord());
        when(mapper.updateData(any(), any(), any(), any(), any())).thenReturn(1);

        ArtifactDataRecordDto result = service.updatePublic(
            "artifact-1", "access-key", "record-1", updateRequest(1));

        assertThat(result.getVersion()).isEqualTo(2);
        assertThat(result.getData()).containsEntry("title", "Book hotel");
        verify(mapper).updateData(org.mockito.Mockito.eq("artifact-1"), org.mockito.Mockito.eq("record-1"),
            org.mockito.Mockito.eq("{\"title\":\"Book hotel\"}"), org.mockito.Mockito.eq(1),
            any(LocalDateTime.class));
    }

    @Test
    void rejectsOversizedJsonBeforeInsert() {
        ReflectionTestUtils.setField(service, "maxRecordBytes", 10);
        ArtifactDataCreateRequest request = createRequest(Map.of("message", "too long"));

        assertThatThrownBy(() -> service.createOwned("artifact-1", request))
            .isInstanceOf(IllegalArgumentException.class)
            .hasMessage("Artifact数据超过单条大小限制");
    }

    private ArtifactDataCreateRequest createRequest(Map<String, Object> data) {
        ArtifactDataCreateRequest request = new ArtifactDataCreateRequest();
        request.setCollectionName("tasks");
        request.setData(data);
        return request;
    }

    private ArtifactDataUpdateRequest updateRequest(int version) {
        ArtifactDataUpdateRequest request = new ArtifactDataUpdateRequest();
        request.setData(Map.of("title", "Book hotel"));
        request.setVersion(version);
        return request;
    }

    private ArtifactDataRecord storedRecord() {
        ArtifactDataRecord record = new ArtifactDataRecord();
        record.setArtifactId("artifact-1");
        record.setCollectionName("tasks");
        record.setRecordKey("record-1");
        record.setDataJson("{\"title\":\"Plan trip\"}");
        record.setVersion(1);
        record.setCreateTime(LocalDateTime.now().minusMinutes(1));
        return record;
    }
}
