package com.iwhalecloud.byai.manager.mapper.groupchat;

import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Insert;
import org.apache.ibatis.annotations.Param;
import org.apache.ibatis.annotations.Select;

import com.baomidou.mybatisplus.core.mapper.BaseMapper;
import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatTaskPublication;

@Mapper
public interface ByaiGroupChatTaskPublicationMapper extends BaseMapper<ByaiGroupChatTaskPublication> {
    /** 私聊按待发布版本保存独立回执，旧版本确认不读取当前草稿。 */
    @Select("SELECT * FROM byai_group_chat_private_publication "
        + "WHERE task_session_id = #{taskId} AND pending_publication_id = #{pendingId}")
    ByaiGroupChatTaskPublication selectPrivate(@Param("taskId") Long taskId, @Param("pendingId") Long pendingId);

    @Insert("INSERT INTO byai_group_chat_private_publication (task_session_id, pending_publication_id, group_session_id, "
        + "message_id, publisher_user_id, text_content, files_json, create_time) VALUES "
        + "(#{taskSessionId}, #{pendingPublicationId}, #{groupSessionId}, #{messageId}, "
        + "#{publisherUserId}, #{textContent}, #{filesJson}, #{createTime})")
    int insertPrivate(ByaiGroupChatTaskPublication publication);

    @Select("SELECT * FROM byai_group_chat_private_publication "
        + "WHERE group_session_id = #{groupId} AND message_id = #{messageId}")
    ByaiGroupChatTaskPublication selectPrivateByMessage(@Param("groupId") Long groupId, @Param("messageId") Long messageId);
}
