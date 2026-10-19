package com.iwhalecloud.byai.state.domain.groupchat.forward;

import static org.assertj.core.api.Assertions.assertThat;
import java.util.List;
import java.util.Map;
import org.junit.jupiter.api.Test;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardRuntimeProjection;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.ForwardReference;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import com.iwhalecloud.byai.state.domain.agent.enums.AgentMetaEnum;
import com.iwhalecloud.byai.state.domain.chat.dto.GroupChatContextResponse;

class ForwardRuntimeProjectionTest {
    @Test
    void itemLocalNamesAreLiteralAndNeverRecursivelyExpanded() {
        var first = new ForwardReference("opaque", "/private/a", "$1\\{{HUMAN_21}}", "COMMON_FILE", "88");
        var second = new ForwardReference("opaque", "/private/b", "另一份", "COMMON_FILE", "89");
        var nested = new ForwardReference("HUMAN_21", "21", "不能展开", "HUMAN", null);
        assertThat(ForwardRuntimeProjection.projectPassive("{{opaque}} {{普通文本}}", List.of(first, nested)))
            .isEqualTo("$1\\{{HUMAN_21}} {{普通文本}}");
        assertThat(ForwardRuntimeProjection.projectPassive("{{opaque}}", List.of(second))).isEqualTo("另一份");
    }

    @Test
    void damagedKnownSnapshotsRemainPassiveAndPublicPreviewIsBounded() throws Exception {
        var json = new ObjectMapper();
        assertThat(ForwardRuntimeProjection.isSnapshotOnly(json.readTree("{\"kind\":\"FORWARD_SINGLE\",\"scene\":false}"))).isTrue();
        assertThat(ForwardRuntimeProjection.isSnapshotOnly(json.readTree("{\"scene\":false,\"forward\":{\"resourceMode\":\"SNAPSHOT_ONLY\",\"mode\":4}}"))).isTrue();
        var entry = Map.of("speakerName", "甲", "content", "😀".repeat(121), "resourceCode", "secret");
        var metadata = json.valueToTree(Map.of("kind", "FORWARD_MERGED", "forward", Map.of("forwardId", "9007199254740993", "mode", "SINGLE", "itemCount", 4, "resourceMode", "SNAPSHOT_ONLY", "preview", List.of(entry, entry, entry, entry), "physicalKey", "secret")));
        var result = json.valueToTree(ForwardRuntimeProjection.publicForward(metadata));
        assertThat(result.path("preview").size()).isEqualTo(3);
        assertThat(result.path("preview").get(0).size()).isEqualTo(2);
        assertThat(result.path("preview").get(0).path("content").asText()).isEqualTo("😀".repeat(120));
        assertThat(result.path("forwardId").asText()).isEqualTo("9007199254740993");
        assertThat(result.has("physicalKey")).isFalse();
    }

    @Test
    void agentProjectionOmitsCapabilitiesButKeepsAttachmentNamesAndLiteralBody() throws Exception {
        var message = new GroupChatContextResponse.Message();
        message.setForward(Map.of("resourceMode", "SNAPSHOT_ONLY"));
        message.setContent("{{opaque}} literal /user/wrote/this");
        ResourceVo resource = new ResourceVo(); resource.setId("opaque"); resource.setResourceName("需求{{HUMAN_21}}");
        resource.setResourceType(AgentMetaEnum.KG_DOC_FILE); resource.setResourceId("/private/path"); resource.setResourceCode("dataset");
        message.setResourceList(List.of(resource));
        var file = new GroupChatContextResponse.Attachment(); file.setFileId("88"); file.setFileUrl("/download");
        file.setFilePath("/private/path"); file.setFileName("需求.pdf"); file.setMediaType("application/pdf"); file.setSize(42L);
        message.setAttachments(List.of(file));
        ForwardRuntimeProjection.agentMessage(message);
        var wire = new ObjectMapper().valueToTree(message);
        assertThat(wire.path("content").asText()).isEqualTo("需求{{HUMAN_21}} literal /user/wrote/this");
        assertThat(wire.has("resourceList")).isFalse();
        assertThat(wire.path("attachments").get(0).size()).isEqualTo(3);
        assertThat(wire.toString()).doesNotContain("/private/path", "/download", "dataset");
    }

    @Test void destinationFileSelectorsRemainSerializableWithoutExtraAttachmentBinding() throws Exception {
        var json = new ObjectMapper();
        ResourceVo input = json.readValue("{\"resourceId\":\"/by/.sessions/20/file.txt\",\"resourceCode\":\"ordinary\",\"extData\":\"ordinary-ext\"}", ResourceVo.class);
        assertThat(json.valueToTree(input).has("targetAttachmentId")).isFalse();
        assertThat(json.valueToTree(input).path("resourceCode").asText()).isEqualTo("ordinary");
    }

}
