package com.iwhalecloud.byai.manager.mapper.resource;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.ResourceSyncJob;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

@Mapper
public interface ResourceSyncJobMapper extends BaseMapper<ResourceSyncJob> {
    @Select("""
        SELECT * FROM byai.byai_resource_sync_job
        WHERE ((status IN ('PENDING', 'PARTIAL', 'FAILED') AND next_retry_time <= CURRENT_TIMESTAMP)
          OR (status = 'RUNNING' AND update_time < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
          AND retry_count < 8 ORDER BY create_time LIMIT 20
        """)
    List<ResourceSyncJob> pending();

    @Update("""
        UPDATE byai.byai_resource_sync_job SET status = 'RUNNING', retry_count = retry_count + 1,
            update_time = CURRENT_TIMESTAMP
        WHERE sync_job_id = #{id} AND retry_count = #{attempt}
          AND (status IN ('PENDING', 'PARTIAL', 'FAILED')
            OR (status = 'RUNNING' AND update_time < CURRENT_TIMESTAMP - INTERVAL '10 minutes'))
        """)
    int claim(@Param("id") Long id, @Param("attempt") Integer attempt);
}
