package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.Date;
import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTopic;

/** 群行锁保护首次创建，活动游标不依赖消息聚合。 */
@Mapper
public interface ByaiGroupChatTopicMapper {
    int upsert(ByaiGroupChatTopic topic);

    List<ByaiGroupChatTopic> selectPage(@Param("sessionId") Long sessionId,
        @Param("beforeTime") Date beforeTime, @Param("beforeMessageId") Long beforeMessageId,
        @Param("beforeTopicId") Long beforeTopicId, @Param("limit") int limit);
}
