package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import java.util.Date;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;

/**
 * 群聊 Agent 执行记录 Mapper。
 */
@Mapper
public interface ByaiGroupChatTurnMapper extends BaseMapper<ByaiGroupChatTurn> {

    int bindRuntime(@Param("executionId") Long executionId, @Param("traceId") String traceId);

    int claim(@Param("executionId") Long executionId, @Param("now") Date now);

    int decideDisposition(@Param("executionId") Long executionId, @Param("disposition") String disposition,
        @Param("taskName") String taskName, @Param("ackText") String ackText,
        @Param("now") Date now);

    int setAckMessage(@Param("executionId") Long executionId, @Param("messageId") Long messageId);

    int markSucceeded(@Param("executionId") Long executionId, @Param("answerMessageId") Long answerMessageId,
        @Param("now") Date now);

    int markFailed(@Param("executionId") Long executionId, @Param("errorCode") String errorCode,
        @Param("errorMessage") String errorMessage, @Param("now") Date now);

    List<ByaiGroupChatTurn> selectRunningExecutions();

    List<ByaiGroupChatTurn> selectQueuedExecutions();
    ByaiGroupChatTurn selectByTrace(@Param("traceId") String traceId);
    ByaiGroupChatTurn selectRunningBySession(@Param("sessionId") Long sessionId);
    ByaiGroupChatTurn selectFirstQueued(@Param("sessionId") Long sessionId);
    ByaiGroupChatTurn selectByTriggerAndAgent(@Param("triggerId") Long triggerId, @Param("agentId") Long agentId);
    ByaiGroupChatTurn selectByPublicMessage(@Param("messageId") Long messageId);
    Long lockGroup(@Param("groupId") Long groupId);
    ByaiGroupChatExecution selectAnchor(@Param("rootId") Long rootId, @Param("agentId") Long agentId,
        @Param("userId") Long userId);
    int resetAfterAssessment(ByaiGroupChatTurn turn);
    ByaiGroupChatTurn selectForUpdateById(@Param("turnId") Long turnId);
}
