package com.iwhalecloud.byai.state.domain.groupchat;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;

import org.junit.jupiter.api.Test;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.groupchat.domain.GroupChatMessagePreview;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;

class GroupChatMessagePreviewTest {
    @Test
    void rendersUserAgentAndHumanPlaceholdersUsingResourceNames() {
        ResourceVo agent = resource(AgentMetaEnum.DIG_EMPLOYEE, "20010807", "官网助手");
        ResourceVo human = resource(AgentMetaEnum.HUMAN, "123", "张三");
        String content = "{{DIG_EMPLOYEE_20010807}} 帮我开发官网，{{HUMAN_123}} 请确认 {{DIG_EMPLOYEE_20010807}}";
        assertThat(GroupChatMessagePreview.format(content, List.of(agent, human)))
            .isEqualTo("@官网助手 帮我开发官网，@张三 请确认 @官网助手");
    }

    @Test
    void rendersAgentMarkdownUsingCanonicalNameOrLinkLabel() {
        assertThat(GroupChatMessagePreview.format(
            "[@旧名称](uid=HUMAN_123) [@助理](uid=DIG_EMPLOYEE_456) [文档](https://example.com)",
            List.of(resource(AgentMetaEnum.HUMAN, "123", "张三"))))
            .isEqualTo("@张三 @助理 [文档](https://example.com)");
    }

    @Test
    void handlesMixedMentionsAndReplacementMetacharactersWithoutRecursing() {
        assertThat(GroupChatMessagePreview.format("{{HUMAN_123}} [@助理](uid=DIG_EMPLOYEE_456)",
            List.of(resource(AgentMetaEnum.HUMAN, "123", "A$1\\B"))))
            .isEqualTo("@A$1\\B @助理");
    }

    @Test
    void leavesUnknownResourcesAndOrdinaryContentIntact() {
        String content = "{{HUMAN_999}} {{KG_DOC_123}} @张三 [@不完整](uid=)";
        assertThat(GroupChatMessagePreview.format(content, List.of())).isEqualTo(content);
        assertThat(GroupChatMessagePreview.format(null, null)).isNull();
        assertThat(GroupChatMessagePreview.format("", null)).isEmpty();
    }

    @Test
    void readsExistingMetadataWithoutMutatingTheResourceSnapshot() {
        JSONObject metadata = new JSONObject();
        metadata.put("resourceList", List.of(resource(AgentMetaEnum.HUMAN, "123", "张三")));
        String stored = JSON.toJSONString(metadata);
        assertThat(GroupChatMessagePreview.fromMetadata("{{HUMAN_123}} 请确认", stored))
            .isEqualTo("@张三 请确认");
        assertThat(JSON.toJSONString(metadata)).isEqualTo(stored);
    }

    @Test
    void missingOrMalformedMetadataDoesNotBreakTheGroupList() {
        for (String metadata : new String[] {null, "", "null", "{broken", "{}"}) {
            assertThat(GroupChatMessagePreview.fromMetadata("[@张三](uid=HUMAN_123)", metadata))
                .isEqualTo("@张三");
        }
    }

    private ResourceVo resource(AgentMetaEnum type, String id, String name) {
        ResourceVo resource = new ResourceVo();
        resource.setResourceType(type);
        resource.setResourceId(id);
        resource.setResourceName(name);
        return resource;
    }
}
