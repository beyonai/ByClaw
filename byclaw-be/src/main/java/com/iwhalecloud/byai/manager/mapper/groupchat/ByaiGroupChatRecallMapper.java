package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatExecution;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTurn;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatRecallStop;

@Mapper
public interface ByaiGroupChatRecallMapper {
    List<ByaiGroupChatTurn> turns(@Param("groupId") Long groupId);
    List<ByaiGroupChatExecution> executions(@Param("groupId") Long groupId);
    void insertStop(ByaiGroupChatRecallStop stop);
    boolean isRecalled(@Param("executionId") Long executionId);
    List<ByaiGroupChatRecallStop> pending(@Param("sessionId") Long sessionId);
    List<Long> pendingSessions(@Param("afterId") Long afterId, @Param("limit") int limit);
    void finishStop(@Param("executionId") Long executionId);
    int cancelTurn(@Param("executionId") Long executionId);
    int cancelExecution(@Param("executionId") Long executionId);
}
