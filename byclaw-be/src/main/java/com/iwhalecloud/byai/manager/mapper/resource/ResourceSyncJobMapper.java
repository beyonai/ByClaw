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
        WHERE ((status IN ('PENDING', 'PARTIAL', 'FAILED', 'PENDING_V2', 'PARTIAL_V2', 'FAILED_V2', 'PENDING_V3', 'PARTIAL_V3', 'FAILED_V3')
            AND next_retry_time <= CURRENT_TIMESTAMP)
          OR (status IN ('RUNNING', 'RUNNING_V2', 'RUNNING_V3') AND update_time < CURRENT_TIMESTAMP - INTERVAL '2' MINUTE))
          AND retry_count < retry_limit ORDER BY create_time LIMIT 20
        """)
    List<ResourceSyncJob> pending();

    @Update("""
        UPDATE byai.byai_resource_sync_job SET status = 'RUNNING_V3', retry_count = retry_count + 1,
            update_time = CURRENT_TIMESTAMP
        WHERE sync_job_id = #{id} AND retry_count = #{attempt}
          AND retry_count < retry_limit
          AND ((status IN ('PENDING', 'PARTIAL', 'FAILED', 'PENDING_V2', 'PARTIAL_V2', 'FAILED_V2', 'PENDING_V3', 'PARTIAL_V3', 'FAILED_V3')
              AND next_retry_time <= CURRENT_TIMESTAMP)
            OR (status IN ('RUNNING', 'RUNNING_V2', 'RUNNING_V3') AND update_time < CURRENT_TIMESTAMP - INTERVAL '2' MINUTE))
        """)
    int claim(@Param("id") Long id, @Param("attempt") Integer attempt);

    @Update("UPDATE byai.byai_resource_sync_job SET update_time=CURRENT_TIMESTAMP WHERE sync_job_id=#{id} AND retry_count=#{attempt} AND status='RUNNING_V3'")
    int heartbeat(@Param("id") Long id, @Param("attempt") Integer attempt);

    @Select("SELECT count(*) FROM byai.byai_resource_sync_job WHERE sync_job_id=#{id} AND retry_count=#{attempt} AND status='RUNNING_V3'")
    int owned(@Param("id") Long id, @Param("attempt") Integer attempt);

    /** A conditional write fences all authorization/association transactions against newer imports. */
    @Update("UPDATE byai.ss_resource SET third_sync_revision=third_sync_revision WHERE resource_id=#{id} AND third_sync_revision=#{revision}")
    int fenceResource(@Param("id") Long id, @Param("revision") Long revision);

    @Update("UPDATE byai.ss_resource SET resource_id=resource_id WHERE resource_id=#{id}")
    int lockResource(@Param("id") Long id);

    @Update("UPDATE byai.byai_resource_sync_job SET status='PENDING_V3', retry_limit=retry_limit+1, next_retry_time=CURRENT_TIMESTAMP + INTERVAL '10' SECOND, result_summary=#{summary}, update_time=CURRENT_TIMESTAMP WHERE sync_job_id=#{id} AND retry_count=#{attempt} AND status='RUNNING_V3'")
    int defer(@Param("id") Long id, @Param("attempt") Integer attempt, @Param("summary") String summary);

    @Select("SELECT * FROM byai.byai_resource_sync_job WHERE resource_id=#{id} ORDER BY sync_revision DESC LIMIT 1")
    ResourceSyncJob latest(@Param("id") Long id);

    @Select("SELECT * FROM byai.byai_resource_sync_job WHERE resource_id=#{id} AND request_id=#{requestId}")
    ResourceSyncJob byRequest(@Param("id") Long id, @Param("requestId") String requestId);

    @Select("""
        <script>
        SELECT j.* FROM byai.byai_resource_sync_job j JOIN
          (SELECT resource_id, MAX(sync_revision) AS revision FROM byai.byai_resource_sync_job
           WHERE resource_id IN <foreach collection="ids" item="id" open="(" separator="," close=")">#{id}</foreach>
           GROUP BY resource_id) latest
        ON j.resource_id=latest.resource_id AND j.sync_revision=latest.revision
        </script>
        """)
    List<ResourceSyncJob> latestBatch(@Param("ids") List<Long> ids);
}
