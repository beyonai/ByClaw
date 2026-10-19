package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import java.util.Date;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Options;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;

@Mapper
public interface ByaiGroupChatTaskMapper extends BaseMapper<ByaiGroupChatTask> {
    /** 读取任务的最新状态，禁用缓存。方法名保留兼容，不附加查询锁。 */
    @Options(flushCache = Options.FlushCachePolicy.TRUE, useCache = false)
    @Select("SELECT * FROM byai_group_chat_task WHERE task_session_id = #{taskId}")
    ByaiGroupChatTask selectForUpdate(@Param("taskId") Long taskId);

    List<ByaiGroupChatTask> selectByGroup(@Param("groupSessionId") Long groupSessionId);

    int completeTurn(@Param("taskSessionId") Long taskSessionId, @Param("traceId") String traceId,
        @Param("turnStatus") String turnStatus, @Param("now") Date now);

    int claimTurn(@Param("taskSessionId") Long taskSessionId, @Param("turnId") Long turnId,
        @Param("now") Date now);

    int bindTurn(@Param("taskSessionId") Long taskSessionId, @Param("turnId") Long turnId,
        @Param("traceId") String traceId, @Param("now") Date now);

    int failTurnStart(@Param("taskSessionId") Long taskSessionId, @Param("turnId") Long turnId,
        @Param("now") Date now);

    List<ByaiGroupChatTask> selectBoundRunningPage(@Param("afterId") Long afterId, @Param("limit") int limit);

    int publish(@Param("taskSessionId") Long taskSessionId, @Param("messageId") Long messageId,
        @Param("publisherUserId") Long publisherUserId, @Param("now") Date now);

    int cancel(@Param("taskSessionId") Long taskSessionId, @Param("now") Date now);
}
