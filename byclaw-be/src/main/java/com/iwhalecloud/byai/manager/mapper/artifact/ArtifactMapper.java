package com.iwhalecloud.byai.manager.mapper.artifact;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.state.domain.artifact.model.ArtifactRecord;
import org.apache.ibatis.annotations.Mapper;

/**
 * Persists artifact lifecycle and storage routing metadata.
 */
@Mapper
public interface ArtifactMapper extends BaseMapper<ArtifactRecord> {
}
