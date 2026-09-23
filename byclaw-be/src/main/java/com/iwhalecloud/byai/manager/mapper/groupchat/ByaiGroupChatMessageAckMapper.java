package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMessageAck;

/** 群消息“收到”确认状态读写。 */
@Mapper
public interface ByaiGroupChatMessageAckMapper {
    int insertIfAbsent(ByaiGroupChatMessageAck ack);

    int deleteByMessageAndUser(@Param("sessionId") Long sessionId, @Param("messageId") Long messageId,
        @Param("userId") Long userId);

    List<ByaiGroupChatMessageAck> selectByMessageIds(@Param("sessionId") Long sessionId,
        @Param("messageIds") List<Long> messageIds);
}
