package com.iwhalecloud.byai.state.domain.groupchat.application;

import java.util.Date;
import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMention;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

/** 把公开群消息中的真人 mention 同步投影到检索表。 */
@Service
public class GroupChatMentionService {
    private final ByaiGroupChatMentionMapper mentionMapper;

    public GroupChatMentionService(ByaiGroupChatMentionMapper mentionMapper) {
        this.mentionMapper = mentionMapper;
    }

    public void indexHumanMentions(Long groupSessionId, Long messageId, Long creatorId, Long creatorUserId,
        List<ResourceVo> resourceList) {
        if (groupSessionId == null || messageId == null || creatorId == null || resourceList == null) {
            return;
        }
        Set<Long> indexedUserIds = new HashSet<>();
        Date now = new Date();
        for (ResourceVo resource : resourceList) {
            if (resource == null || resource.getResourceType() != AgentMetaEnum.HUMAN) {
                continue;
            }
            Long mentionedUserId = parseUserId(resource.getResourceId());
            if (mentionedUserId == null || mentionedUserId.equals(creatorUserId)
                || !indexedUserIds.add(mentionedUserId)) {
                continue;
            }
            ByaiGroupChatMention mention = new ByaiGroupChatMention();
            mention.setGroupSessionId(groupSessionId);
            mention.setMessageId(messageId);
            mention.setMentionedUserId(mentionedUserId);
            mention.setCreatorId(creatorId);
            mention.setCreateTime(now);
            mentionMapper.insertIfAbsent(mention);
        }
    }

    private Long parseUserId(String resourceId) {
        try {
            return resourceId == null ? null : Long.valueOf(resourceId);
        }
        catch (NumberFormatException ignored) {
            // 入站路径已校验 resourceId，Agent 投影仍在此处保持防御性跳过。
            return null;
        }
    }
}
