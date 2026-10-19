package com.iwhalecloud.byai.manager.mapper.groupchat;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatForwardItem;
import org.apache.ibatis.annotations.*;
import java.util.List;

/** Source-card rows join the current bound message, never historical source_message_id. */
@Mapper
public interface ByaiGroupChatForwardSourceMapper {
    @Select("SELECT i.* FROM byai_group_chat_forward_item i JOIN byai_group_chat_forward_target t ON t.target_id=i.target_id AND t.enterprise_id=i.enterprise_id WHERE i.enterprise_id=#{tenant} AND i.bound_message_id=#{message} AND t.target_session_id=#{group} AND t.state='SUCCEEDED' ORDER BY i.ordinal")
    List<ByaiGroupChatForwardItem> items(@Param("tenant") long tenant, @Param("group") long group, @Param("message") long message);
}
