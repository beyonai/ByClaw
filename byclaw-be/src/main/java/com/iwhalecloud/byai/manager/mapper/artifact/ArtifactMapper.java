package com.iwhalecloud.byai.manager.mapper.artifact;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import java.time.LocalDateTime;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Update;

/**
 * Persists artifact lifecycle and storage routing metadata.
 */
@Mapper
public interface ArtifactMapper extends BaseMapper<ArtifactRecord> {

    @Update("""
        UPDATE byai_artifact
        SET kind = #{replacement.kind},
            original_key = #{replacement.originalKey},
            content_prefix = #{replacement.contentPrefix},
            original_name = #{replacement.originalName},
            display_name = #{replacement.displayName},
            entry_point = #{replacement.entryPoint},
            content_type = #{replacement.contentType},
            file_size = #{replacement.fileSize},
            expanded_size = #{replacement.expandedSize},
            sha256 = #{replacement.sha256},
            warnings_json = #{replacement.warningsJson},
            update_time = #{updateTime}
        WHERE artifact_id = #{replacement.artifactId}
          AND owner_user_id = #{ownerUserId}
          AND status = 'READY'
          AND purge_at > #{updateTime}
          AND original_key = #{expectedOriginalKey}
          AND content_prefix = #{expectedContentPrefix}
        """)
    int replaceContent(@Param("replacement") ArtifactRecord replacement, @Param("ownerUserId") Long ownerUserId,
        @Param("expectedOriginalKey") String expectedOriginalKey,
        @Param("expectedContentPrefix") String expectedContentPrefix,
        @Param("updateTime") LocalDateTime updateTime);

    @Update("""
        UPDATE byai_artifact
        SET expires_at = #{expiresAt},
            purge_at = #{purgeAt},
            update_time = #{updateTime}
        WHERE artifact_id = #{artifactId}
          AND owner_user_id = #{ownerUserId}
          AND status = 'READY'
          AND purge_at > #{updateTime}
        """)
    int renewExpiration(@Param("artifactId") String artifactId, @Param("ownerUserId") Long ownerUserId,
        @Param("expiresAt") LocalDateTime expiresAt, @Param("purgeAt") LocalDateTime purgeAt,
        @Param("updateTime") LocalDateTime updateTime);

    @Update("""
        UPDATE byai_artifact
        SET purge_at = #{purgeAt},
            update_time = #{accessTime}
        WHERE artifact_id = #{artifactId}
          AND status = 'READY'
          AND purge_at > #{accessTime}
          AND purge_at < #{purgeAt}
        """)
    int renewPurgeAt(@Param("artifactId") String artifactId, @Param("purgeAt") LocalDateTime purgeAt,
        @Param("accessTime") LocalDateTime accessTime);
}
