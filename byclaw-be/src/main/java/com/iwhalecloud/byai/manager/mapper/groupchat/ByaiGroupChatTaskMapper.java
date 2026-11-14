package com.iwhalecloud.byai.manager.mapper.groupchat;

import com.iwhalecloud.byai.common.lock.RedisTransactionLock;
import java.util.List;
import java.util.Date;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;
import org.apache.ibatis.annotations.Options;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.common.message.qo.MessageHotPageQo;

@Mapper
public interface ByaiGroupChatTaskMapper extends BaseMapper<ByaiGroupChatTask> {
    /** 与继续对话、取消及待发布替换共用任务 Redis 事务锁，避免上传期间内容发生变化。 */
    @Options(flushCache = Options.FlushCachePolicy.TRUE, useCache = false)
    @Select("SELECT * FROM byai_group_chat_task WHERE task_session_id = #{taskId}")
    @RedisTransactionLock(value = "group-task", parameters = {"taskId"})
    ByaiGroupChatTask selectWithRedisLock(@Param("taskId") Long taskId);

    List<ByaiGroupChatTask> selectByGroup(@Param("groupSessionId") Long groupSessionId);

    List<ByaiGroupChatTask> selectVisibleByGroup(@Param("groupSessionId") Long groupSessionId, @Param("userId") Long userId);

    ByaiGroupChatTask selectBoundDirect(@Param("groupId") Long groupId, @Param("userId") Long userId, @Param("agentId") Long agentId);

    ByaiGroupChatTask selectEarliestPrivate(@Param("groupId") Long groupId, @Param("userId") Long userId,
        @Param("agentId") Long agentId);

    int insertDirectBinding(ByaiGroupChatTask task);

    int restoreCancelledPrivate(@Param("taskId") Long taskId, @Param("now") Date now);

    int restoreClosedDirectSession(@Param("taskId") Long taskId, @Param("now") Date now);

    @org.apache.ibatis.annotations.Select("SELECT COUNT(*) FROM byai_group_human_task_session WHERE task_session_id=#{taskId}")
    int countHumanBinding(@Param("taskId") Long taskId);

    /** 专用待办私聊不参与普通固定员工私聊的最早会话选择。 */
    @org.apache.ibatis.annotations.Select("SELECT COUNT(*) FROM byai_group_human_task_session h JOIN byai_group_human_task t ON t.human_task_id=h.human_task_id WHERE h.task_session_id=#{taskId} AND h.entry_type='PRIVATE' AND t.group_session_id=#{groupId}")
    int countHumanPrivateBinding(@Param("taskId") Long taskId, @Param("groupId") Long groupId);

    ByaiSession selectLegacyDirectSession(@Param("groupId") Long groupId, @Param("userId") Long userId, @Param("agentId") Long agentId);

    ByaiGroupChatTask selectDirectOwner(@Param("sessionId") Long sessionId);

    List<ByaiMessage> selectReadableHistoryPage(@Param("qo") MessageHotPageQo query, @Param("actorId") Long actorId);

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
