package com.iwhalecloud.byai.manager.mapper.resource;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Update;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.resource.UserMcpToolSnapshot;

@Mapper
public interface UserMcpToolSnapshotMapper extends BaseMapper<UserMcpToolSnapshot> {

    @Update("""
        UPDATE byai_user_mcp_tool_snapshot
        SET status_cd = '00X'
        WHERE resource_id = #{resourceId}
          AND status_cd = '00A'
        """)
    int deactivateActive(@Param("resourceId") Long resourceId);

    @Select("""
        SELECT *
        FROM byai_user_mcp_tool_snapshot
        WHERE resource_id = #{resourceId}
          AND snapshot_version = #{snapshotVersion}
          AND status_cd = '00A'
        ORDER BY tool_name
        """)
    List<UserMcpToolSnapshot> selectActiveSnapshot(
        @Param("resourceId") Long resourceId,
        @Param("snapshotVersion") Long snapshotVersion);

    @Select("""
        SELECT *
        FROM byai_user_mcp_tool_snapshot
        WHERE resource_id = #{resourceId}
          AND snapshot_version = #{snapshotVersion}
          AND tool_name = #{toolName}
          AND status_cd = '00A'
        """)
    UserMcpToolSnapshot selectActiveTool(
        @Param("resourceId") Long resourceId,
        @Param("snapshotVersion") Long snapshotVersion,
        @Param("toolName") String toolName);

    @Select("""
        SELECT *
        FROM byai_user_mcp_tool_snapshot
        WHERE resource_id = #{resourceId}
          AND tool_name = #{toolName}
          AND status_cd = '00A'
        ORDER BY snapshot_version DESC
        LIMIT 1
        """)
    UserMcpToolSnapshot selectLatestActiveTool(
        @Param("resourceId") Long resourceId,
        @Param("toolName") String toolName);
}
