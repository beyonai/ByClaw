package com.iwhalecloud.byai.state.domain.groupchat.forward;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardModels.*;
import com.iwhalecloud.byai.state.domain.groupchat.forward.domain.ForwardSnapshotFactory.SourceMessage;
import org.junit.jupiter.api.Test;
import java.nio.file.Path;
import java.util.*;
import static org.assertj.core.api.Assertions.*;

class ForwardSnapshotFactoryTest {
    final ObjectMapper mapper = new ObjectMapper();
    final ForwardSnapshotFactory factory = new ForwardSnapshotFactory();
    final ForwardActor actor = new ForwardActor(20, 10);
    List<SourceMessage> messages() throws Exception {
        return mapper.readerForListOf(SourceMessage.class).readValue(mapper.readTree(Path.of("../byclaw-qa/fixtures/group-chat-forward/v1.json").toFile()).get("messages"));
    }
    @Test void preservesOpaqueReferenceKeysPerItem() throws Exception {
        var sources = messages();
        var frozen = factory.freeze(actor, 30, List.of(sources.get(1), sources.get(0)));
        assertThat(frozen.items().getFirst().resourceList().getFirst().id()).isEqualTo("KG_DOC_FILE_xxx");
        assertThat(frozen.items().getFirst().resourceList().get(1).id()).isEqualTo("HUMAN_20");
        assertThat(frozen.items().get(1).resourceList().getFirst().resourceName()).isEqualTo("另一条名称");
        assertThat(mapper.writeValueAsString(frozen.items())).doesNotContain("resourceCode", "extData");
        assertThat(factory.projectText(frozen.items().getFirst())).isEqualTo("预算$\\终稿 旧名字 {{text}}");
        assertThatThrownBy(() -> frozen.items().clear()).isInstanceOf(UnsupportedOperationException.class);
    }
    @Test void copiesOrFlattensExistingCard() throws Exception {
        var sources = messages();
        var original = sources.getFirst();
        var second = sources.get(1);
        var card = new SourceMessage(second.id(), second.timelineOrdinal(), second.content(), second.speaker(), second.createdAt(), second.resourceList(), second.relatedResources(), second.metadata(), List.of(original, second));
        var frozen = factory.freeze(actor, 30, List.of(original, card));
        assertThat(frozen.items()).extracting(ForwardItemTemplate::selectedMessageId).containsExactly(original.id(), card.id(), card.id());
        assertThat(frozen.items()).extracting(ForwardItemTemplate::selectedMergedCard).containsExactly(false, true, true);
        var one = new SourceMessage(second.id(), 2, second.content(), second.speaker(), second.createdAt(), second.resourceList(), Map.of(), Map.of(), List.of(original));
        assertThat(factory.freeze(actor, 30, List.of(one)).items().getFirst().selectedMergedCard()).isTrue();
    }
    @Test void rejectsConflictingReferenceOrigins() throws Exception {
        var original = messages().getFirst();
        var refs = new ArrayList<>(original.resourceList());
        var conflict = new HashMap<>(refs.getFirst());
        conflict.put("resourceCode", "another-dataset");
        refs.add(conflict);
        var source = new SourceMessage(original.id(), 1, original.content(), original.speaker(), original.createdAt(), refs, Map.of(), Map.of(), List.of());
        assertThatThrownBy(() -> factory.freeze(actor, 30, List.of(source))).hasMessageContaining("FORWARD_REFERENCE_CONFLICT");
    }
    @Test void rejectsUtf8OverflowAndMissingReferences() throws Exception {
        var original = messages().getFirst();
        var oversized = new SourceMessage(original.id(), 1, "中".repeat(350000), original.speaker(), original.createdAt(), List.of(), Map.of(), Map.of(), List.of());
        assertThatThrownBy(() -> factory.freeze(actor, 30, List.of(oversized))).hasMessageContaining("FORWARD_SNAPSHOT_TOO_LARGE");
        var missing = new SourceMessage(original.id(), 1, "{{KG_DOC_FILE_missing}}", original.speaker(), original.createdAt(), List.of(), Map.of(), Map.of(), List.of());
        assertThatThrownBy(() -> factory.freeze(actor, 30, List.of(missing))).hasMessageContaining("FORWARD_RESOURCE_UNRESOLVABLE");
    }
    @Test void untypedReferencesReachResolutionWithoutPersistingRawSecrets() throws Exception {
        var original = messages().getFirst();
        var source = new SourceMessage(original.id(), 1, "{{KG_DOC_FILE_opaque}}", original.speaker(), original.createdAt(),
            List.of(Map.of("id", "KG_DOC_FILE_opaque", "resourceId", "not-a-file-id", "resourceName", "label", "resourceCode", "secret")), Map.of(),
            Map.of("token", "secret", "files", List.of(Map.of("fileId", "501", "fileName", "copied.pdf"))), List.of());
        var frozen = factory.freeze(actor, 30, List.of(source));
        assertThat(frozen.candidates()).hasSize(2);
        assertThat(frozen.candidates().getFirst().kind().name()).isEqualTo("UNRESOLVED_REFERENCE");
        assertThat(mapper.writeValueAsString(frozen.candidates())).doesNotContain("secret", "sourceSpeaker", "sourceMetadata");
        assertThat(frozen.items().getFirst().resourceList().getFirst().id()).isEqualTo("KG_DOC_FILE_opaque");
    }
    @Test void folderNeverListsChildren() throws Exception {
        var original = messages().getFirst();
        var source = new SourceMessage(original.id(), 1, "{{COMMON_FOLDER_x}}", original.speaker(), original.createdAt(),
            List.of(Map.of("id", "COMMON_FOLDER_x", "resourceType", "COMMON_FOLDER", "resourceId", "/private", "resourceName", "folder")), Map.of(), Map.of(), List.of());
        assertThat(factory.freeze(actor, 30, List.of(source)).candidates()).isEmpty();
    }
    @Test void acceptsHundredItemsAndRejectsExpandedOverflow() throws Exception {
        var original = messages().getFirst();
        List<SourceMessage> hundred = new ArrayList<>();
        for (int i = 1; i <= 100; i++) hundred.add(new SourceMessage(i, i, "{{text}}", original.speaker(), original.createdAt(), List.of(), Map.of(), Map.of(), List.of()));
        assertThat(factory.freeze(actor, 30, hundred).items()).hasSize(100);
        hundred.add(original);
        var card = new SourceMessage(original.id(), 1, "", original.speaker(), original.createdAt(), List.of(), Map.of(), Map.of(), hundred);
        assertThatThrownBy(() -> factory.freeze(actor, 30, List.of(card))).hasMessageContaining("FORWARD_TOO_MANY_ITEMS");
    }

    @Test void mapsKnownPassiveLegacyTypes() throws Exception {
        var original = messages().getFirst();
        var source = new SourceMessage(original.id(), 1, "{{DATA_SOURCE_ds}} {{MCP_TOOL_mt}}", original.speaker(), original.createdAt(),
                List.of(Map.of("resourceType", "DATA_SOURCE", "resourceId", "ds", "resourceName", "数据源"), Map.of("resourceType", "MCP_TOOL", "resourceId", "mt", "resourceName", "工具")), Map.of(), Map.of(), List.of());
        var result = factory.freeze(actor, 30, List.of(source));
        assertThat(result.items().getFirst().resourceList()).extracting(ForwardReference::id).containsExactly("DATA_SOURCE_ds", "MCP_TOOL_mt");
        assertThat(result.candidates()).isEmpty();
    }

}
