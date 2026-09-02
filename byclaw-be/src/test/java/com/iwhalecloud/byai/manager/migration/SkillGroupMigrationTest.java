package com.iwhalecloud.byai.manager.migration;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.Locale;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.junit.jupiter.api.Test;

class SkillGroupMigrationTest {

    private static final String MIGRATION_PATH = "deploy/migrations/versions/V0.4.0/V0.4.0__ddl.sql";
    private static final Pattern DUPLICATE_GUARD_PATTERN =
            Pattern.compile("do \\$\\$ begin .*?raise exception .*?end \\$\\$;");
    private static final Pattern NORMAL_INDEX_PATTERN =
            Pattern.compile("create index if not exists idx_ss_resource_rel_group_member .*?;");
    private static final Pattern UNIQUE_INDEX_PATTERN = Pattern.compile(
            "create unique index if not exists uk_ss_resource_rel_group_member .*?;");
    private static final Pattern SOURCE_CANDIDATE_INDEX_PATTERN = Pattern.compile(
            "create index if not exists idx_ss_resource_rel_skill_source_candidate .*?;");

    @Test
    void resourceBizTypeIncludesSkillGroup() {
        assertThat(ResourceBizTypeEnum.valueOf("SKILL_GROUP").name()).isEqualTo("SKILL_GROUP");
    }

    @Test
    void migrationGuardsDuplicatesBeforeCreatingSkillGroupMemberIndexes() throws IOException {
        String sql = readMigration();
        String duplicateGuard = extract(sql, DUPLICATE_GUARD_PATTERN, "duplicate guard");
        String normalIndex = extract(sql, NORMAL_INDEX_PATTERN, "normal index");
        String uniqueIndex = extract(sql, UNIQUE_INDEX_PATTERN, "unique index");
        String sourceCandidateIndex =
                extract(sql, SOURCE_CANDIDATE_INDEX_PATTERN, "source candidate index");

        assertDuplicateGuard(duplicateGuard);
        assertThat(normalIndex).isEqualTo(
                "create index if not exists idx_ss_resource_rel_group_member "
                        + "on byai.ss_resource_rel_detail "
                        + "(resource_id, rel_type_name, rel_status, rel_resource_id);");
        assertThat(uniqueIndex).isEqualTo(
                "create unique index if not exists uk_ss_resource_rel_group_member "
                        + "on byai.ss_resource_rel_detail (resource_id, rel_resource_id, rel_type_name) "
                        + "where rel_type_name = 'skill_group_member' and rel_status = 1;");
        assertThat(sourceCandidateIndex).isEqualTo(
                "create index if not exists idx_ss_resource_rel_skill_source_candidate "
                        + "on byai.ss_resource_rel_detail (resource_id, rel_type_name, rel_status) "
                        + "where rel_resource_info is not null;");

        assertThat(sql)
                .contains("comment on column byai.ss_resource.resource_biz_type")
                .contains("skill_group=技能组");
        assertThat(sql.indexOf(duplicateGuard))
                .isLessThan(sql.indexOf(normalIndex))
                .isLessThan(sql.indexOf(uniqueIndex));
    }

    @Test
    void duplicateGuardAssertionsRejectMissingActiveStatusFilter() {
        String weakenedGuard = normalize("""
                DO $$
                BEGIN
                    IF EXISTS (
                        SELECT 1
                        FROM byai.ss_resource_rel_detail
                        WHERE rel_type_name = 'SKILL_GROUP_MEMBER'
                        GROUP BY resource_id, rel_resource_id, rel_type_name
                        HAVING COUNT(*) > 1
                    ) THEN
                        RAISE EXCEPTION 'Duplicate active SKILL_GROUP_MEMBER relationships exist';
                    END IF;
                END
                $$;
                """);

        assertThatThrownBy(() -> assertDuplicateGuard(weakenedGuard)).isInstanceOf(AssertionError.class);
    }

    private static void assertDuplicateGuard(String duplicateGuard) {
        assertThat(duplicateGuard)
                .contains("where rel_type_name = 'skill_group_member'")
                .contains("and rel_status = 1")
                .contains("group by resource_id, rel_resource_id, rel_type_name")
                .contains("having count(*) > 1")
                .contains("raise exception");
    }

    private static String extract(String sql, Pattern pattern, String description) {
        Matcher matcher = pattern.matcher(sql);
        assertThat(matcher.find()).as("migration contains %s", description).isTrue();
        return matcher.group();
    }

    private static String readMigration() throws IOException {
        Path repoRoot = Path.of("").toAbsolutePath();
        while (repoRoot != null && !Files.exists(repoRoot.resolve("deploy/migrations/versions"))) {
            repoRoot = repoRoot.getParent();
        }
        assertThat(repoRoot).as("repository root").isNotNull();
        return normalize(Files.readString(repoRoot.resolve(MIGRATION_PATH)));
    }

    private static String normalize(String sql) {
        return sql.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }
}
