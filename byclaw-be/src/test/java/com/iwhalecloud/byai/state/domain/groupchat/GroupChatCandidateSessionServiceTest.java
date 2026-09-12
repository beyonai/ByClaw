package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.NullAndEmptySource;
import org.junit.jupiter.params.provider.ValueSource;
import org.mockito.ArgumentCaptor;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessage;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.mapper.message.ByaiMessageMapper;
import com.iwhalecloud.byai.state.domain.groupchat.application.GroupChatCandidateSessionService;
import com.iwhalecloud.byai.state.domain.session.service.SessionExtService;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;

class GroupChatCandidateSessionServiceTest {
    private final SessionService sessionService = mock(SessionService.class);
    private final ByaiMessageMapper messageMapper = mock(ByaiMessageMapper.class);
    private final SequenceService sequenceService = mock(SequenceService.class);
    private final GroupChatCandidateSessionService service = new GroupChatCandidateSessionService(sessionService,
        mock(SessionExtService.class), messageMapper, sequenceService);

    @Test
    void preservesCompleteResourceListAndOriginalContentInChildMessage() {
        String metadata = """
            {"scene":"GROUP_CHAT","clientRequestId":"request-1","resourceList":[
              {"id":"DIG_EMPLOYEE_501","resourceId":"501","resourceName":"素材采集助理(官方认证)",
               "resourceType":"DIG_EMPLOYEE"},
              {"id":"HUMAN_601","resourceId":"601","resourceName":"群成员","resourceType":"HUMAN"}
            ]}
            """;
        ByaiMessage source = source(metadata);

        ByaiMessage child = createChild(source);

        JSONObject childMetadata = JSON.parseObject(child.getMetadata());
        assertThat(childMetadata.getString("scene")).isEqualTo("GROUP_TASK");
        assertThat(childMetadata.getJSONArray("resourceList"))
            .isEqualTo(JSON.parseObject(metadata).getJSONArray("resourceList"));
        assertThat(childMetadata.containsKey("clientRequestId")).isFalse();
        assertThat(child.getMessageContent()).isEqualTo(source.getMessageContent());
        assertThat(child.getSessionId()).isEqualTo(900L);
        assertThat(source.getMetadata()).isEqualTo(metadata);
    }

    @ParameterizedTest
    @NullAndEmptySource
    @ValueSource(strings = {" ", "{}", "{\"scene\":\"GROUP_CHAT\"}"})
    void createsChildWhenSourceHasNoResourceList(String metadata) {
        ByaiMessage child = createChild(source(metadata));

        assertThat(JSON.parseObject(child.getMetadata()))
            .containsEntry("scene", "GROUP_TASK")
            .doesNotContainKey("resourceList");
    }

    @ParameterizedTest
    @ValueSource(strings = {"[]", "null"})
    void preservesEmptyOrNullResourceList(String resourceList) {
        ByaiMessage child = createChild(source("{\"resourceList\":" + resourceList + "}"));

        // Fastjson 默认省略 null 字段，空列表则应保持为空列表。
        assertThat(JSON.parseObject(child.getMetadata()).get("resourceList"))
            .isEqualTo(JSON.parse(resourceList));
    }

    private ByaiMessage source(String metadata) {
        ByaiMessage source = new ByaiMessage();
        source.setMessageContent("{{DIG_EMPLOYEE_501}} 帮我采集新闻 {{HUMAN_601}}");
        source.setMetadata(metadata);
        return source;
    }

    private ByaiMessage createChild(ByaiMessage source) {
        ByaiSession group = new ByaiSession();
        group.setProjectId(400L);
        when(sessionService.findById(100L)).thenReturn(group);
        when(messageMapper.selectByMessageId(200L)).thenReturn(source);
        when(sequenceService.nextVal()).thenReturn(900L, 901L, 902L, 903L, 904L);

        assertThat(service.create(100L, 200L, 300L, 501L)).isEqualTo(900L);

        ArgumentCaptor<ByaiMessage> captor = ArgumentCaptor.forClass(ByaiMessage.class);
        verify(messageMapper).insert(captor.capture());
        return captor.getValue();
    }
}
