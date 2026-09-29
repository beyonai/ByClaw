package com.iwhalecloud.byai.common.constants.resource;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;

import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.junit.jupiter.params.provider.ValueSource;

/** 四类已下线资源业务类型统一停用规则的纯函数单测（单一事实来源）。 */
class DisabledResourceBizTypesTest {

    @Test
    void codesAreExactlyTheFourDisabledTypes() {
        assertThat(DisabledResourceBizTypes.codes())
            .containsExactlyInAnyOrder("OBJECT", "VIEW", "ONTOLOGY_BASE", "SCENE")
            .hasSize(4)
            .doesNotContain("ACTION", "TAG", "KG_CLOUD", "SKILL", "KG_DOC", "DIG_EMPLOYEE", "MCP_TOOL");
    }

    @Test
    void codesAreImmutable() {
        assertThat(DisabledResourceBizTypes.codes()).isUnmodifiable();
    }

    @Test
    void aliasSetIsEmpty() {
        // 已核实结论：本基线 Java 侧不存在需要额外归一化的历史别名（ONTOLOGY 仅出现在前端防御字符串）。
        assertThat(DisabledResourceBizTypes.aliases()).isEmpty();
    }

    @Test
    void reasonCodeIsStableForPluginSide() {
        assertThat(DisabledResourceBizTypes.REASON_CODE).isEqualTo("RESOURCE_TYPE_DISABLED");
    }

    @ParameterizedTest
    @ValueSource(strings = {"OBJECT", "object", "Object", "oBjEcT", " OBJECT ", "\tVIEW\n", "view", "View",
        "ONTOLOGY_BASE", "ontology_base", "Ontology_Base", "SCENE", "scene", "Scene"})
    void normalizationCoversCaseAndWhitespace(String raw) {
        assertThat(DisabledResourceBizTypes.isDisabled(raw)).as("raw=%s", raw).isTrue();
        assertThat(DisabledResourceBizTypes.isEnabled(raw)).isFalse();
    }

    @Test
    void nullAndBlankAreNotDisabled() {
        assertThat(DisabledResourceBizTypes.isDisabled(null)).isFalse();
        assertThat(DisabledResourceBizTypes.isDisabled("")).isFalse();
        assertThat(DisabledResourceBizTypes.isDisabled("   ")).isFalse();
        assertThat(DisabledResourceBizTypes.normalize(null)).isEmpty();
        assertThat(DisabledResourceBizTypes.normalize("  Object ")).isEqualTo("OBJECT");
    }

    @ParameterizedTest
    @CsvSource({"KG_DOC", "KG_DB", "KG_QA", "KG_TERM", "SKILL", "TOOLKIT", "TOOL", "MCP", "MCP_TOOL",
        "AGENT", "DIG_EMPLOYEE", "DB_DATASET", "TAG", "ACTION", "DOC", "ONTOLOGY", "OBJECTX", "FOO",
        "OBJECT_1", "OBJECT_999"})
    void normalAndForgedTypesAreNotDisabled(String raw) {
        // 伪造类型（OBJECTX / OBJECT_1）不得被判为停用：真实类型判定 + SQL 排除共同保证不可取回。
        assertThat(DisabledResourceBizTypes.isDisabled(raw)).as("raw=%s", raw).isFalse();
    }

    @Test
    void containsAnyDisabledHandlesNullAndMixedLists() {
        assertThat(DisabledResourceBizTypes.containsAnyDisabled(null)).isFalse();
        assertThat(DisabledResourceBizTypes.containsAnyDisabled(List.of())).isFalse();
        assertThat(DisabledResourceBizTypes.containsAnyDisabled(Arrays.asList("KG_DOC", null, " "))).isFalse();
        assertThat(DisabledResourceBizTypes.containsAnyDisabled(Arrays.asList("KG_DOC", "object"))).isTrue();
    }

    @Test
    void enabledOnlyFiltersDisabledAndDedupes() {
        List<String> candidates = new ArrayList<>(Arrays.asList("kg_doc", "OBJECT", " KG_DOC ", "view", null, "", "SKILL"));
        assertThat(DisabledResourceBizTypes.enabledOnly(candidates))
            .containsExactly("KG_DOC", "SKILL");
        assertThat(DisabledResourceBizTypes.enabledOnly(List.of("OBJECT"))).isEmpty();
        assertThat(DisabledResourceBizTypes.enabledOnly(null)).isEmpty();
        assertThat(DisabledResourceBizTypes.enabledOnly(List.of())).isEmpty();
    }
}
