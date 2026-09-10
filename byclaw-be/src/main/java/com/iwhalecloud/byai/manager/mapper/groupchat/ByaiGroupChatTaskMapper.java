package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;

@Mapper
public interface ByaiGroupChatTaskMapper extends BaseMapper<ByaiGroupChatTask> {
    List<ByaiGroupChatTask> selectByGroup(@Param("groupSessionId") Long groupSessionId);

    int updateTurnStatus(@Param("taskSessionId") Long taskSessionId, @Param("turnStatus") String turnStatus,
        @Param("now") java.util.Date now);

    int claimTurn(@Param("taskSessionId") Long taskSessionId, @Param("now") java.util.Date now);

    int publish(@Param("taskSessionId") Long taskSessionId, @Param("messageId") Long messageId,
        @Param("publisherUserId") Long publisherUserId, @Param("now") java.util.Date now);

    int cancel(@Param("taskSessionId") Long taskSessionId, @Param("now") java.util.Date now);
}
