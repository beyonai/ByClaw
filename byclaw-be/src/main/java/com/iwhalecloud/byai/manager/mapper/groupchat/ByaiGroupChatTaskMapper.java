package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;
import java.util.Date;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTask;

@Mapper
public interface ByaiGroupChatTaskMapper extends BaseMapper<ByaiGroupChatTask> {
    /** 与继续对话、取消及待发布替换共用任务行锁，避免上传期间内容发生变化。 */
    @Select("SELECT * FROM byai_group_chat_task WHERE task_session_id = #{taskId} FOR UPDATE")
    ByaiGroupChatTask selectForUpdate(@Param("taskId") Long taskId);

    List<ByaiGroupChatTask> selectByGroup(@Param("groupSessionId") Long groupSessionId);

    int updateTurnStatus(@Param("taskSessionId") Long taskSessionId, @Param("turnStatus") String turnStatus,
        @Param("now") Date now);

    int claimTurn(@Param("taskSessionId") Long taskSessionId, @Param("now") Date now);

    int publish(@Param("taskSessionId") Long taskSessionId, @Param("messageId") Long messageId,
        @Param("publisherUserId") Long publisherUserId, @Param("now") Date now);

    int cancel(@Param("taskSessionId") Long taskSessionId, @Param("now") Date now);
}
