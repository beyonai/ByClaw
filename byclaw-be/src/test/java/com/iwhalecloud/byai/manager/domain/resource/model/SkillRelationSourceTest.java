package com.iwhalecloud.byai.manager.domain.resource.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import org.junit.jupiter.api.Test;

class SkillRelationSourceTest {

    @Test
    void parse_legacyOrInvalidInputDefaultsToManual() {
        assertMalformedManual(SkillRelationSource.parse(null));
        assertMalformedManual(SkillRelationSource.parse("  "));
        assertMalformedManual(SkillRelationSource.parse("{not-json"));
        assertMalformedManual(SkillRelationSource.parse("42"));
        assertMalformedManual(SkillRelationSource.parse("[10001]"));
        assertMalformedManual(SkillRelationSource.parse("{\"legacy\":true}"));
    }

    @Test
    void groups_canBeAddedAndRemovedWhileRetainingOtherSources() {
        SkillRelationSource source = SkillRelationSource.parse("{\"manual\":false,\"sourceGroupIds\":[]}");

        source.addGroup(10001L);
        source.addGroup(10002L);
        source.removeGroup(10001L);

        assertThat(source.getSourceGroupIds()).containsExactly(10002L);
        assertThat(source.hasGroup(10001L)).isFalse();
        assertThat(source.hasGroup(10002L)).isTrue();
        assertThat(source.hasAnySource()).isTrue();
    }

    @Test
    void groups_ignoreNullAndDuplicateIds() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[10001,null,10001,10002]}"
        );

        source.addGroup(null);
        source.addGroup(10002L);
        source.removeGroup(null);

        assertThat(source.getSourceGroupIds()).containsExactly(10001L, 10002L);
        assertThat(source.hasGroup(null)).isFalse();
    }

    @Test
    void validSource_roundTripsWithDeterministicOrder() {
        SkillRelationSource source = SkillRelationSource.manual();
        source.addGroup(10002L);
        source.addGroup(10001L);

        String json = source.toJson();
        SkillRelationSource roundTripped = SkillRelationSource.parse(json);

        assertThat(json).isEqualTo("{\"manual\":true,\"sourceGroupIds\":[10001,10002]}");
        assertThat(roundTripped.isManual()).isTrue();
        assertThat(roundTripped.getSourceGroupIds()).containsExactly(10001L, 10002L);
    }

    @Test
    void toJson_isEquivalentForReverseInsertionOrder() {
        SkillRelationSource forward = SkillRelationSource.parse("{\"sourceGroupIds\":[]}");
        forward.addGroup(10001L);
        forward.addGroup(10002L);
        SkillRelationSource reverse = SkillRelationSource.parse("{\"sourceGroupIds\":[]}");
        reverse.addGroup(10002L);
        reverse.addGroup(10001L);

        assertThat(reverse.toJson()).isEqualTo(forward.toJson());
        assertThat(reverse.toJson()).isEqualTo("{\"manual\":false,\"sourceGroupIds\":[10001,10002]}");
    }

    @Test
    void groupOnlySource_hasNoSourceAfterLastGroupIsRemoved() {
        SkillRelationSource source = SkillRelationSource.parse("{\"sourceGroupIds\":[10001]}");

        assertThat(source.isManual()).isFalse();
        assertThat(source.hasAnySource()).isTrue();

        source.removeGroup(10001L);

        assertThat(source.hasAnySource()).isFalse();
    }

    @Test
    void exposedGroupSetCannotMutateInternalState() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[10001]}"
        );

        assertThatThrownBy(() -> source.getSourceGroupIds().add(10002L))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThat(source.getSourceGroupIds()).containsExactly(10001L);
    }

    @Test
    void parse_mixedValidAndInvalidGroupsRetainsRecoverableGroupsAndSignalsMalformed() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[\"10001\",10002.5,10003,null]}"
        );

        assertThat(source.isManual()).isTrue();
        assertThat(source.isMalformed()).isTrue();
        assertThat(source.getSourceGroupIds()).containsExactly(10003L);
        assertThat(source.hasGroup(10003L)).isTrue();
        assertThat(source.hasAnySource()).isTrue();
    }

    @Test
    void parse_allInvalidGroupsFailsClosedWithoutCoercion() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[\"10001\",10002.5,{},true]}"
        );

        assertMalformedManual(source);
    }

    @Test
    void parse_overflowGroupFailsClosed() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[9223372036854775808]}"
        );

        assertMalformedManual(source);
    }

    @Test
    void parse_rejectsUnsafePropertyCoercionsWithoutThrowing() {
        assertMalformedManual(SkillRelationSource.parse("{\"manual\":\"false\",\"sourceGroupIds\":[10001]}"));
        assertMalformedManual(SkillRelationSource.parse("{\"manual\":false,\"sourceGroupIds\":10001}"));
        assertMalformedManual(SkillRelationSource.parse("{\"manual\":null,\"sourceGroupIds\":[10001]}"));
        assertMalformedManual(SkillRelationSource.parse("{\"manual\":false,\"sourceGroupIds\":null}"));
    }

    private static void assertManual(SkillRelationSource source) {
        assertThat(source.isManual()).isTrue();
        assertThat(source.isMalformed()).isFalse();
        assertThat(source.getSourceGroupIds()).isEmpty();
        assertThat(source.hasAnySource()).isTrue();
    }

    private static void assertMalformedManual(SkillRelationSource source) {
        assertThat(source.isManual()).isTrue();
        assertThat(source.isMalformed()).isTrue();
        assertThat(source.getSourceGroupIds()).isEmpty();
        assertThat(source.hasAnySource()).isTrue();
    }
}
