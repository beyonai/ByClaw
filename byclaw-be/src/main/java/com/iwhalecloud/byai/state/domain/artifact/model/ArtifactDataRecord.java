package com.iwhalecloud.byai.state.domain.artifact.model;

import com.baomidou.mybatisplus.annotation.IdType;
import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import java.time.LocalDateTime;
import lombok.Getter;
import lombok.Setter;

/**
 * Stores one schemaless JSON record persisted by a published Artifact.
 */
@Getter
@Setter
@TableName("artifact_data_record")
public class ArtifactDataRecord {

    @TableId(value = "id", type = IdType.INPUT)
    private String id;

    private String artifactId;

    private String collectionName;

    private String recordKey;

    private String dataJson;

    private Integer version;

    private LocalDateTime createTime;

    private LocalDateTime updateTime;
}
