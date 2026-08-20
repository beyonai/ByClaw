package com.iwhalecloud.byai.manager.mapper.artifact;

import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactDataRecord;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Delete;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

/**
 * Persists Artifact data while explicitly casting serialized JSON to the database JSONB type.
 */
@Mapper
public interface ArtifactDataRecordMapper {

    @Delete("DELETE FROM artifact_data_record WHERE artifact_id = #{artifactId}")
    int deleteByArtifactId(@Param("artifactId") String artifactId);

    @Insert("""
        INSERT INTO artifact_data_record (
            id, artifact_id, collection_name, record_key, data_json, version, create_time, update_time
        ) VALUES (
            #{id}, #{artifactId}, #{collectionName}, #{recordKey}, CAST(#{dataJson} AS JSONB),
            #{version}, #{createTime}, #{updateTime}
        )
        """)
    int insert(ArtifactDataRecord record);

    @Select("""
        SELECT id, artifact_id, collection_name, record_key, data_json::text AS data_json,
               version, create_time, update_time
        FROM artifact_data_record
        WHERE artifact_id = #{artifactId}
          AND record_key = #{recordKey}
        """)
    ArtifactDataRecord selectByRecordKey(@Param("artifactId") String artifactId,
        @Param("recordKey") String recordKey);

    @Update("""
        UPDATE artifact_data_record
        SET data_json = CAST(#{dataJson} AS JSONB),
            version = version + 1,
            update_time = #{updateTime}
        WHERE artifact_id = #{artifactId}
          AND record_key = #{recordKey}
          AND version = #{expectedVersion}
        """)
    int updateData(@Param("artifactId") String artifactId, @Param("recordKey") String recordKey,
        @Param("dataJson") String dataJson,
        @Param("expectedVersion") Integer expectedVersion, @Param("updateTime") LocalDateTime updateTime);
}
