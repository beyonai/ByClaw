package com.iwhalecloud.byai.manager.mapper.groupchat;

import java.util.List;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMention;
import com.iwhalecloud.byai.state.domain.groupchat.dto.GroupChatListItemResponse;

/** 群聊 mention 索引与未读投影查询。 */
@Mapper
public interface ByaiGroupChatMentionMapper {
    int insertIfAbsent(ByaiGroupChatMention mention);

    List<GroupChatListItemResponse> selectMyGroups(@Param("userId") Long userId);

    GroupChatListItemResponse selectMentionState(@Param("sessionId") Long sessionId,
        @Param("userId") Long userId);
}
