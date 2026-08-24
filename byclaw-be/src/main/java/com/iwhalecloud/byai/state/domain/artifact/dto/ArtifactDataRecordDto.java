package com.iwhalecloud.byai.state.domain.artifact.dto;

import java.time.LocalDateTime;
import java.util.Map;
import lombok.Builder;
import lombok.Getter;

/**
 * Returns a persisted Artifact JSON record and its optimistic-lock version.
 */
@Getter
@Builder
public class ArtifactDataRecordDto {

    private String recordKey;

    private String collectionName;

    private Map<String, Object> data;

    private Integer version;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}
