package com.iwhalecloud.byai.manager.domain.resource.model;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.Set;
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

    @Test
    void parse_v1MapsGroupsToLegacyAndRetainsCanonicalV1Json() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[7002,7001]}"
        );

        assertThat(source.getLegacySourceGroupIds()).containsExactly(7002L, 7001L);
        assertThat(source.getGroupInstallers()).isEmpty();
        assertThat(source.getSourceGroupIds()).containsExactly(7002L, 7001L);
        assertThat(source.toJson()).isEqualTo("{\"manual\":false,\"sourceGroupIds\":[7001,7002]}");
    }

    @Test
    void v2TracksInstallersAndSerializesDeterministically() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001,7002],"
                + "\"legacySourceGroupIds\":[7001],\"groupInstallers\":{\"7002\":[10002,10001]}}"
        );

        assertThat(source.hasGroupInstaller(7002L, 10001L)).isTrue();
        source.removeGroupInstaller(7002L, 10001L);
        source.addGroupInstaller(7003L, 10004L);
        source.addGroupInstaller(7003L, 10003L);

        assertThat(source.getSourceGroupIds()).containsExactly(7001L, 7002L, 7003L);
        assertThat(source.toJson()).isEqualTo(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001,7002,7003],"
                + "\"legacySourceGroupIds\":[7001],"
                + "\"groupInstallers\":{\"7002\":[10002],\"7003\":[10003,10004]}}"
        );
    }

    @Test
    void introducingInstallerAttributionPermanentlyUpgradesV1SourceToV2() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"manual\":false,\"sourceGroupIds\":[7001]}"
        );

        source.addGroupInstaller(7002L, 10001L);
        source.removeGroupInstaller(7002L, 10001L);

        assertThat(source.toJson()).isEqualTo(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[7001],\"groupInstallers\":{}}"
        );
    }

    @Test
    void manualCopiesAndFullGroupRemovalPreserveV2AttributionSemantics() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"version\":2,\"manual\":true,\"sourceGroupIds\":[7001,7002],"
                + "\"legacySourceGroupIds\":[7001],\"groupInstallers\":{\"7001\":[10001],\"7002\":[10002]}}"
        );

        SkillRelationSource withoutManual = source.withoutManual();
        SkillRelationSource withManual = withoutManual.withManual();
        withoutManual.removeGroup(7001L);

        assertThat(withoutManual.isManual()).isFalse();
        assertThat(withoutManual.getLegacySourceGroupIds()).isEmpty();
        assertThat(withoutManual.getGroupInstallers()).containsOnlyKeys(7002L);
        assertThat(withoutManual.getSourceGroupIds()).containsExactly(7002L);
        assertThat(withManual.isManual()).isTrue();
        assertThat(withManual.getLegacySourceGroupIds()).containsExactly(7001L);
        assertThat(withManual.getGroupInstallers()).containsOnlyKeys(7001L, 7002L);
    }

    @Test
    void removeInstallerFromAllGroupsRemovesOnlyThatUserAndDropsEmptyGroups() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001,7002,7003],"
                + "\"legacySourceGroupIds\":[7003],"
                + "\"groupInstallers\":{\"7001\":[10001],\"7002\":[10001,10002]}}"
        );

        source.removeInstallerFromAllGroups(10001L);

        assertThat(source.getGroupInstallers()).containsOnlyKeys(7002L);
        assertThat(source.getGroupInstallers().get(7002L)).containsExactly(10002L);
        assertThat(source.getSourceGroupIds()).containsExactly(7003L, 7002L);
    }

    @Test
    void exposedV2CollectionsCannotMutateInternalState() {
        SkillRelationSource source = SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"7001\":[10001]}}"
        );

        assertThatThrownBy(() -> source.getLegacySourceGroupIds().add(7002L))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> source.getGroupInstallers().put(7002L, Set.of(10002L)))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThatThrownBy(() -> source.getGroupInstallers().get(7001L).add(10002L))
            .isInstanceOf(UnsupportedOperationException.class);
        assertThat(source.hasGroupInstaller(7001L, 10002L)).isFalse();
    }

    @Test
    void parse_v2RejectsUnknownKeysInvalidArraysAndInconsistentCompatibilityView() {
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{},\"unknown\":true}"
        ));
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[\"7001\"],\"groupInstallers\":{}}"
        ));
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"group\":[10001]}}"
        ));
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"7001\":[\"10001\"]}}"
        ));
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":2,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{}}"
        ));
    }

    @Test
    void parse_rejectsDeclaredUnsupportedOrNonIntegralVersions() {
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":3,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"7001\":[10001]}}"
        ));
        assertMalformedManual(SkillRelationSource.parse(
            "{\"version\":2.0,\"manual\":false,\"sourceGroupIds\":[7001],"
                + "\"legacySourceGroupIds\":[],\"groupInstallers\":{\"7001\":[10001]}}"
        ));
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
