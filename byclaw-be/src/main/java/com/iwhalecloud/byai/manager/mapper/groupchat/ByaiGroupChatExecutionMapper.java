package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import java.util.Date;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;

/**
 * 群聊 Agent 执行记录 Mapper。
 */
@Mapper
public interface ByaiGroupChatExecutionMapper extends BaseMapper<ByaiGroupChatExecution> {

    ByaiGroupChatExecution selectBySourceAndAgent(@Param("sourceMessageId") Long sourceMessageId,
        @Param("targetAgentId") Long targetAgentId);

    ByaiGroupChatExecution selectForUpdateByCandidateSessionId(@Param("candidateSessionId") Long candidateSessionId);

    int bindRuntime(@Param("executionId") Long executionId, @Param("traceId") String traceId);

    int claim(@Param("executionId") Long executionId, @Param("now") Date now);

    ByaiGroupChatExecution selectNextQueued();

    ByaiGroupChatExecution selectByCandidateSessionId(@Param("candidateSessionId") Long candidateSessionId);

    int decideDisposition(@Param("executionId") Long executionId, @Param("disposition") String disposition,
        @Param("taskName") String taskName, @Param("ackText") String ackText,
        @Param("now") Date now);

    int setAckMessage(@Param("executionId") Long executionId, @Param("messageId") Long messageId);

    int insertEventIfAbsent(@Param("executionId") Long executionId, @Param("eventId") String eventId,
        @Param("eventType") String eventType);

    int markSucceeded(@Param("executionId") Long executionId, @Param("answerMessageId") Long answerMessageId,
        @Param("now") Date now);

    int markFailed(@Param("executionId") Long executionId, @Param("errorCode") String errorCode,
        @Param("errorMessage") String errorMessage, @Param("now") Date now);

    List<ByaiGroupChatExecution> selectStaleRunning(@Param("before") Date before);

    int requeueStaleRunning(@Param("before") Date before);

    List<ByaiGroupChatExecution> selectRunningExecutions();

    List<ByaiGroupChatExecution> selectQueuedExecutions();
}
