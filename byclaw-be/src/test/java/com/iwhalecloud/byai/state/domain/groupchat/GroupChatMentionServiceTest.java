package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.mockito.ArgumentCaptor;

import com.iwhalecloud.byai.manager.entity.groupchat.ByaiGroupChatMention;
import com.iwhalecloud.byai.manager.mapper.groupchat.ByaiGroupChatMentionMapper;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatMentionService;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

class GroupChatMentionServiceTest {
    @Test
    void indexesDistinctHumanMentionsAndIgnoresSelfMention() {
        ByaiGroupChatMentionMapper mapper = mock(ByaiGroupChatMentionMapper.class);
        GroupChatMentionService service = new GroupChatMentionService(mapper);

        service.indexHumanMentions(10L, 20L, 30L, 30L, List.of(
            resource(AgentMetaEnum.HUMAN, "40"),
            resource(AgentMetaEnum.HUMAN, "40"),
            resource(AgentMetaEnum.HUMAN, "30"),
            resource(AgentMetaEnum.DIG_EMPLOYEE, "50")));

        ArgumentCaptor<ByaiGroupChatMention> captor = ArgumentCaptor.forClass(ByaiGroupChatMention.class);
        verify(mapper, times(1)).insertIfAbsent(captor.capture());
        ByaiGroupChatMention mention = captor.getValue();
        assertThat(mention.getGroupSessionId()).isEqualTo(10L);
        assertThat(mention.getMessageId()).isEqualTo(20L);
        assertThat(mention.getCreatorId()).isEqualTo(30L);
        assertThat(mention.getMentionedUserId()).isEqualTo(40L);
    }

    @Test
    void agentMentionIsNotTreatedAsSelfMentionWhenIdsOverlap() {
        ByaiGroupChatMentionMapper mapper = mock(ByaiGroupChatMentionMapper.class);
        GroupChatMentionService service = new GroupChatMentionService(mapper);

        service.indexHumanMentions(10L, 20L, 30L, null,
            List.of(resource(AgentMetaEnum.HUMAN, "30")));

        ArgumentCaptor<ByaiGroupChatMention> captor = ArgumentCaptor.forClass(ByaiGroupChatMention.class);
        verify(mapper).insertIfAbsent(captor.capture());
        assertThat(captor.getValue().getCreatorId()).isEqualTo(30L);
        assertThat(captor.getValue().getMentionedUserId()).isEqualTo(30L);
    }

    private ResourceVo resource(AgentMetaEnum type, String id) {
        ResourceVo resource = new ResourceVo();
        resource.setResourceType(type);
        resource.setResourceId(id);
        return resource;
    }
}
