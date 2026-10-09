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

    default List<GroupChatListItemResponse> selectMyGroups(Long userId) {
        return selectMyGroupsScoped(userId, null);
    }

    default List<GroupChatListItemResponse> selectMyGroups(Long userId, Long enterpriseId) {
        return selectMyGroupsScoped(userId, enterpriseId);
    }

    List<GroupChatListItemResponse> selectMyGroupsScoped(@Param("userId") Long userId,
        @Param("enterpriseId") Long enterpriseId);

    boolean isLegacyGroupMember(@Param("sessionId") Long sessionId, @Param("userId") Long userId,
        @Param("enterpriseId") Long enterpriseId);

    GroupChatListItemResponse selectMentionState(@Param("sessionId") Long sessionId,
        @Param("userId") Long userId);

    boolean existsUserMention(@Param("sessionId") Long sessionId, @Param("messageId") Long messageId,
        @Param("userId") Long userId);
}
