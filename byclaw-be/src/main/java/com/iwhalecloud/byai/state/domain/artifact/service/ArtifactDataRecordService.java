package com.iwhalecloud.byai.state.domain.artifact.service;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.mapper.artifact.ArtifactDataRecordMapper;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataCreateRequest;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataRecordDto;
import com.iwhalecloud.byai.state.domain.artifact.dto.ArtifactDataUpdateRequest;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactDataRecord;
import java.nio.charset.StandardCharsets;
import java.time.LocalDateTime;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Pattern;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Creates, queries, and updates bounded JSON records owned by published Artifacts.
 */
@Service
public class ArtifactDataRecordService {

    private static final TypeReference<Map<String, Object>> DATA_TYPE = new TypeReference<>() { };

    private static final Pattern COLLECTION_NAME_PATTERN = Pattern.compile("[A-Za-z][A-Za-z0-9_-]{0,63}");

    private final ArtifactDataRecordMapper dataRecordMapper;
    private final ArtifactApplicationService artifactApplicationService;
    private final ObjectMapper objectMapper;

    @Value("${artifact.data.max-record-bytes:65536}")
    private int maxRecordBytes;

    public ArtifactDataRecordService(ArtifactDataRecordMapper dataRecordMapper,
        ArtifactApplicationService artifactApplicationService, ObjectMapper objectMapper) {
        this.dataRecordMapper = dataRecordMapper;
        this.artifactApplicationService = artifactApplicationService;
        this.objectMapper = objectMapper;
    }

    @Transactional
    public ArtifactDataRecordDto createPublic(String artifactId, ArtifactDataCreateRequest request) {
        artifactApplicationService.requirePublicDataAccessible(artifactId);
        return create(artifactId, request);
    }

    @Transactional(readOnly = true)
    public PageInfo<ArtifactDataRecordDto> listPublic(String artifactId, String accessKey,
        String collectionName, int pageNum, int pageSize) {
        artifactApplicationService.requireManagementDataAccessible(artifactId, accessKey);
        validatePage(pageNum, pageSize);
        String normalizedCollection = normalizeCollectionName(collectionName);

        long total = dataRecordMapper.countByArtifact(artifactId, normalizedCollection);
        PageInfo<ArtifactDataRecordDto> result = new PageInfo<>();
        result.setPageNum(pageNum);
        result.setPageSize(pageSize);
        result.setTotal(total);
        long pages = total / pageSize + (total % pageSize == 0 ? 0 : 1);
        result.setTotalPages((int) Math.min(pages, Integer.MAX_VALUE));
        if (total == 0) {
            result.setList(Collections.emptyList());
            return result;
        }

        long offset = (long) (pageNum - 1) * pageSize;
        List<ArtifactDataRecordDto> records = dataRecordMapper.selectPageByArtifact(
                artifactId, normalizedCollection, offset, pageSize)
            .stream()
            .map(this::toDto)
            .toList();
        result.setList(records);
        return result;
    }

    @Transactional(readOnly = true)
    public ArtifactDataRecordDto getPublic(String artifactId, String recordKey) {
        artifactApplicationService.requirePublicDataAccessible(artifactId);
        return toDto(requireRecord(artifactId, recordKey));
    }

    @Transactional
    public ArtifactDataRecordDto updatePublic(String artifactId, String recordKey,
        ArtifactDataUpdateRequest request) {
        artifactApplicationService.requirePublicDataAccessible(artifactId);
        return update(artifactId, recordKey, request);
    }

    private ArtifactDataRecordDto create(String artifactId, ArtifactDataCreateRequest request) {
        LocalDateTime now = LocalDateTime.now();
        ArtifactDataRecord record = new ArtifactDataRecord();
        record.setId(UUID.randomUUID().toString());
        record.setArtifactId(artifactId);
        record.setCollectionName(request.getCollectionName());
        record.setRecordKey(UUID.randomUUID().toString());
        record.setDataJson(serializeData(request.getData()));
        record.setVersion(1);
        record.setCreateTime(now);
        record.setUpdateTime(now);
        if (dataRecordMapper.insert(record) != 1) {
            throw new IllegalStateException("Artifact数据保存失败");
        }
        return toDto(record);
    }

    private ArtifactDataRecordDto update(String artifactId, String recordKey, ArtifactDataUpdateRequest request) {
        ArtifactDataRecord stored = requireRecord(artifactId, recordKey);
        if (!stored.getVersion().equals(request.getVersion())) {
            throw new IllegalArgumentException("记录已被更新，请使用最新version重试");
        }
        LocalDateTime now = LocalDateTime.now();
        String dataJson = serializeData(request.getData());
        int updated = dataRecordMapper.updateData(artifactId, recordKey, dataJson, request.getVersion(), now);
        if (updated != 1) {
            throw new IllegalArgumentException("记录已被更新，请使用最新version重试");
        }
        return ArtifactDataRecordDto.builder()
            .recordKey(recordKey)
            .collectionName(stored.getCollectionName())
            .data(deserializeData(dataJson))
            .version(request.getVersion() + 1)
            .createTime(stored.getCreateTime())
            .updateTime(now)
            .build();
    }

    private ArtifactDataRecord requireRecord(String artifactId, String recordKey) {
        ArtifactDataRecord record = dataRecordMapper.selectByRecordKey(artifactId, recordKey);
        if (record == null) {
            throw new IllegalArgumentException("Artifact数据记录不存在");
        }
        return record;
    }

    private void validatePage(int pageNum, int pageSize) {
        if (pageNum < 1) {
            throw new IllegalArgumentException("pageNum必须大于等于1");
        }
        if (pageSize < 1 || pageSize > 100) {
            throw new IllegalArgumentException("pageSize必须在1到100之间");
        }
    }

    private String normalizeCollectionName(String collectionName) {
        String normalized = StringUtils.trimToNull(collectionName);
        if (normalized != null && !COLLECTION_NAME_PATTERN.matcher(normalized).matches()) {
            throw new IllegalArgumentException(
                "collectionName必须以字母开头，且只能包含字母、数字、下划线或连字符");
        }
        return normalized;
    }

    private String serializeData(Object data) {
        try {
            String json = objectMapper.writeValueAsString(data);
            if (json.getBytes(StandardCharsets.UTF_8).length > maxRecordBytes) {
                throw new IllegalArgumentException("Artifact数据超过单条大小限制");
            }
            return json;
        }
        catch (JsonProcessingException e) {
            throw new IllegalArgumentException("Artifact数据不是有效JSON", e);
        }
    }

    private Map<String, Object> deserializeData(String dataJson) {
        try {
            return objectMapper.readValue(dataJson, DATA_TYPE);
        }
        catch (JsonProcessingException e) {
            throw new IllegalStateException("Artifact存储的数据不是有效JSON对象", e);
        }
    }

    private ArtifactDataRecordDto toDto(ArtifactDataRecord record) {
        return ArtifactDataRecordDto.builder()
            .recordKey(record.getRecordKey())
            .collectionName(record.getCollectionName())
            .data(deserializeData(record.getDataJson()))
            .version(record.getVersion())
            .createTime(record.getCreateTime())
            .updateTime(record.getUpdateTime())
            .build();
    }

}
