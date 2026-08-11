package com.iwhalecloud.byai.manager.skillgroup;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupMemberStatus;
import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupUninstallMode;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCreateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCandidatePageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupIdQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupInstallQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupMemberChangeQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupPageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUpdateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUninstallQo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupInstallResultVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberStatusSummaryVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupUninstallPreviewVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupUninstallSkillVo;
import jakarta.validation.ConstraintViolation;
import jakarta.validation.Validation;
import jakarta.validation.Validator;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.apache.ibatis.builder.xml.XMLMapperBuilder;
import org.apache.ibatis.io.Resources;
import org.apache.ibatis.mapping.BoundSql;
import org.apache.ibatis.session.Configuration;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.EnumSource;

class SkillGroupContractTest {

    private static final String MAPPER_RESOURCE =
            "com/iwhalecloud/byai/manager/mapper/resource/SkillGroupMapper.xml";
    private static final String MAPPER_NAMESPACE = SkillGroupMapper.class.getName() + ".";
    private static final Validator VALIDATOR = Validation.buildDefaultValidatorFactory().getValidator();
    private static final ObjectMapper OBJECT_MAPPER = new ObjectMapper();

    @Test
    void requestObjectsExposeExpectedFieldsAndPageDefaults() {
        SkillGroupIdQo idQo = new SkillGroupIdQo();
        idQo.setGroupId(20001L);
        idQo.setDigitalEmployeeId(10001L);
        SkillGroupInstallQo installQo = new SkillGroupInstallQo();
        installQo.setDigitalEmployeeId(10001L);
        installQo.setGroupId(20001L);

        SkillGroupMemberChangeQo memberChangeQo = new SkillGroupMemberChangeQo();
        memberChangeQo.setGroupId(20001L);
        memberChangeQo.setSkillIds(List.of(30001L, 30002L));

        SkillGroupPageQo pageQo = new SkillGroupPageQo();
        pageQo.setKeyword("analysis");
        pageQo.setOwnerType("enterprise");
        pageQo.setResourceStatus(1);
        pageQo.setCatalogId(40001L);
        SkillGroupCandidatePageQo candidatePageQo = new SkillGroupCandidatePageQo();
        candidatePageQo.setGroupId(20001L);

        assertThat(installQo.getDigitalEmployeeId()).isEqualTo(10001L);
        assertThat(idQo.getDigitalEmployeeId()).isEqualTo(10001L);
        assertThat(installQo.getGroupId()).isEqualTo(20001L);
        assertThat(memberChangeQo.getGroupId()).isEqualTo(20001L);
        assertThat(memberChangeQo.getSkillIds()).containsExactly(30001L, 30002L);
        assertThat(pageQo.getPageNum()).isEqualTo(1);
        assertThat(pageQo.getPageSize()).isEqualTo(10);
        assertThat(pageQo.getKeyword()).isEqualTo("analysis");
        assertThat(pageQo.getOwnerType()).isEqualTo("enterprise");
        assertThat(pageQo.getResourceStatus()).isEqualTo(1);
        assertThat(pageQo.getCatalogId()).isEqualTo(40001L);
        assertThat(candidatePageQo.getGroupId()).isEqualTo(20001L);
        assertThat(candidatePageQo.getPageNum()).isEqualTo(1);
        assertThat(candidatePageQo.getPageSize()).isEqualTo(10);
    }

    @Test
    void responseCollectionsInitializeEmptyAndRemainIndependent() {
        SkillGroupVo groupVo = new SkillGroupVo();
        SkillGroupInstallResultVo resultVo = new SkillGroupInstallResultVo();

        assertThat(groupVo.getMembers()).isEmpty();
        assertThat(resultVo.getInstalledSkillIds()).isEmpty();
        assertThat(resultVo.getExistingSkillIds()).isEmpty();
        assertThat(resultVo.getRemovedSkillIds()).isEmpty();
        assertThat(resultVo.getRetainedSkillIds()).isEmpty();
        assertThat(resultVo.getTotalSkillIds()).isEmpty();
        assertThat(resultVo.getAppliedSkillIds()).isEmpty();
        assertThat(resultVo.getPendingSkillIds()).isEmpty();
        assertThat(resultVo.getUnavailableSkillIds()).isEmpty();

        groupVo.getMembers().add(new SkillGroupMemberVo());
        resultVo.getInstalledSkillIds().add(10001L);
        resultVo.getExistingSkillIds().add(10002L);
        resultVo.getRemovedSkillIds().add(10003L);
        resultVo.getRetainedSkillIds().add(10004L);
        resultVo.getTotalSkillIds().add(10005L);

        assertThat(groupVo.getMembers()).hasSize(1);
        assertThat(resultVo.getInstalledSkillIds()).containsExactly(10001L);
        assertThat(resultVo.getExistingSkillIds()).containsExactly(10002L);
        assertThat(resultVo.getRemovedSkillIds()).containsExactly(10003L);
        assertThat(resultVo.getRetainedSkillIds()).containsExactly(10004L);
        assertThat(resultVo.getTotalSkillIds()).containsExactly(10005L);
    }

    @Test
    void uninstallContractsExposeStableModesAndStringIds() throws Exception {
        SkillGroupUninstallQo qo = new SkillGroupUninstallQo();
        qo.setGroupId(7001L);
        qo.setDigitalEmployeeId(8001L);
        assertThat(qo.getMode()).isEqualTo(SkillGroupUninstallMode.PRESERVE_SHARED);

        SkillGroupUninstallSkillVo shared = new SkillGroupUninstallSkillVo();
        shared.setResourceId(9002L);
        shared.setManualSource(true);
        shared.setOtherGroupIds(List.of(7002L));
        SkillGroupUninstallPreviewVo preview = new SkillGroupUninstallPreviewVo();
        preview.setInstalledByGroup(true);
        preview.setPreviewToken("token");
        preview.setSharedSkills(List.of(shared));

        String json = OBJECT_MAPPER.writeValueAsString(preview);
        assertThat(json).contains("\"resourceId\":\"9002\"");
        assertThat(json).contains("\"otherGroupIds\":[\"7002\"]");
    }

    @Test
    void memberStatusSummaryCountsFiveStatesAndPreservesMemberOrder() {
        List<SkillGroupMemberVo> members = List.of(
                member(5L, SkillGroupMemberStatus.APPLY_PENDING),
                member(2L, SkillGroupMemberStatus.INSTALLED),
                member(5L, SkillGroupMemberStatus.APPLY_REQUIRED),
                member(3L, SkillGroupMemberStatus.INSTALLABLE),
                member(4L, SkillGroupMemberStatus.APPLY_UNAVAILABLE));

        SkillGroupMemberStatusSummaryVo summary = SkillGroupMemberStatusSummaryVo.from(members);

        assertThat(summary.getMembers()).containsExactlyElementsOf(members);
        assertThat(summary.getTotal()).isEqualTo(5);
        assertThat(summary.getInstalled()).isEqualTo(1);
        assertThat(summary.getInstallable()).isEqualTo(1);
        assertThat(summary.getApplyRequired()).isEqualTo(1);
        assertThat(summary.getApplyPending()).isEqualTo(1);
        assertThat(summary.getUnavailable()).isEqualTo(1);
    }

    private static SkillGroupMemberVo member(Long id, SkillGroupMemberStatus status) {
        SkillGroupMemberVo member = new SkillGroupMemberVo();
        member.setResourceId(id);
        member.setMemberStatus(status);
        return member;
    }

    @Test
    void requiredIdsListsAndNamesAreValidated() {
        SkillGroupCreateQo createQo = new SkillGroupCreateQo();
        createQo.setOwnerType("team");

        SkillGroupUpdateQo updateQo = new SkillGroupUpdateQo();

        SkillGroupIdQo idQo = new SkillGroupIdQo();
        SkillGroupInstallQo installQo = new SkillGroupInstallQo();
        SkillGroupMemberChangeQo memberChangeQo = new SkillGroupMemberChangeQo();

        assertInvalidProperties(createQo, "resourceName", "ownerType");
        assertInvalidProperties(updateQo, "groupId", "resourceName");
        assertInvalidProperties(idQo, "groupId");
        assertInvalidProperties(installQo, "digitalEmployeeId", "groupId");
        assertInvalidProperties(memberChangeQo, "groupId", "skillIds");

        memberChangeQo.setGroupId(20001L);
        memberChangeQo.setSkillIds(Collections.singletonList(null));
        assertInvalidProperties(memberChangeQo, "skillIds");
    }

    @Test
    void pageBoundsAreValidated() {
        SkillGroupPageQo pageQo = new SkillGroupPageQo();
        pageQo.setPageNum(0);
        pageQo.setPageSize(101);

        assertInvalidProperties(pageQo, "pageNum", "pageSize");

        pageQo.setPageNum(1);
        pageQo.setPageSize(0);
        assertInvalidProperties(pageQo, "pageSize");
    }

    @Test
    void pageOptionalTextFiltersEnforceAllowedOwnerAndMaximumKeywordLength() {
        SkillGroupPageQo pageQo = new SkillGroupPageQo();
        assertThat(VALIDATOR.validate(pageQo)).isEmpty();

        pageQo.setOwnerType("");
        pageQo.setKeyword("");
        assertThat(VALIDATOR.validate(pageQo)).isEmpty();

        pageQo.setOwnerType("personal");
        pageQo.setKeyword("k".repeat(300));
        assertThat(VALIDATOR.validate(pageQo)).isEmpty();

        pageQo.setOwnerType("team");
        pageQo.setKeyword("k".repeat(301));
        assertInvalidProperties(pageQo, "ownerType", "keyword");
    }

    @Test
    void createAndUpdateAcceptMaximumLengthsAndRejectOverLimitValues() {
        SkillGroupCreateQo createQo = new SkillGroupCreateQo();
        createQo.setResourceName("n".repeat(300));
        createQo.setResourceDesc("d".repeat(4000));
        createQo.setAvatar("a".repeat(1024));
        createQo.setOwnerType("enterprise");
        assertThat(VALIDATOR.validate(createQo)).isEmpty();

        SkillGroupUpdateQo updateQo = new SkillGroupUpdateQo();
        updateQo.setGroupId(20001L);
        updateQo.setResourceName("n".repeat(300));
        updateQo.setResourceDesc("d".repeat(4000));
        updateQo.setAvatar("a".repeat(1024));
        assertThat(VALIDATOR.validate(updateQo)).isEmpty();

        createQo.setResourceName("n".repeat(301));
        createQo.setResourceDesc("d".repeat(4001));
        createQo.setAvatar("a".repeat(1025));
        assertInvalidProperties(createQo, "resourceName", "resourceDesc", "avatar");

        updateQo.setResourceName("n".repeat(301));
        updateQo.setResourceDesc("d".repeat(4001));
        updateQo.setAvatar("a".repeat(1025));
        assertInvalidProperties(updateQo, "resourceName", "resourceDesc", "avatar");
    }

    @ParameterizedTest
    @EnumSource(SkillGroupMemberStatus.class)
    void resourceIdsAndMemberStatusesSerializeWithStableWireValues(SkillGroupMemberStatus memberStatus)
            throws Exception {
        SkillGroupVo groupVo = new SkillGroupVo();
        groupVo.setResourceId(10001L);
        SkillGroupMemberVo memberVo = new SkillGroupMemberVo();
        memberVo.setResourceId(20001L);
        memberVo.setSystemBuiltIn(true);
        memberVo.setCreatorOwned(false);
        memberVo.setMemberStatus(memberStatus);
        memberVo.setStatusReason("reason");
        memberVo.setInstalled(true);
        memberVo.setHasUsePermission(false);
        SkillGroupInstallResultVo resultVo = new SkillGroupInstallResultVo();
        resultVo.getInstalledSkillIds().add(30001L);
        resultVo.getExistingSkillIds().add(30002L);
        resultVo.getRemovedSkillIds().add(30003L);
        resultVo.getRetainedSkillIds().add(30004L);
        resultVo.getTotalSkillIds().add(30005L);

        JsonNode groupJson = OBJECT_MAPPER.readTree(OBJECT_MAPPER.writeValueAsString(groupVo));
        JsonNode memberJson = OBJECT_MAPPER.readTree(OBJECT_MAPPER.writeValueAsString(memberVo));
        JsonNode resultJson = OBJECT_MAPPER.readTree(OBJECT_MAPPER.writeValueAsString(resultVo));

        assertThat(groupJson.path("resourceId").isTextual()).isTrue();
        assertThat(groupJson.path("resourceId").asText()).isEqualTo("10001");
        assertThat(memberJson.path("resourceId").isTextual()).isTrue();
        assertThat(memberJson.path("resourceId").asText()).isEqualTo("20001");
        assertThat(memberJson.path("systemBuiltIn").asBoolean()).isTrue();
        assertThat(memberJson.path("creatorOwned").asBoolean()).isFalse();
        assertThat(memberJson.path("memberStatus").asText()).isEqualTo(memberStatus.name());
        assertThat(memberJson.path("statusReason").asText()).isEqualTo("reason");
        assertThat(memberJson.path("installed").asBoolean()).isTrue();
        assertThat(memberJson.path("hasUsePermission").asBoolean()).isFalse();
        assertTextualArrayEntry(resultJson, "installedSkillIds", "30001");
        assertTextualArrayEntry(resultJson, "existingSkillIds", "30002");
        assertTextualArrayEntry(resultJson, "removedSkillIds", "30003");
        assertTextualArrayEntry(resultJson, "retainedSkillIds", "30004");
        assertTextualArrayEntry(resultJson, "totalSkillIds", "30005");
    }

    @Test
    void pageAndDetailStatementsContainTheirOwnGroupVisibilityContracts() throws Exception {
        String xml = readMapperXml();
        String page = expandSqlIncludes(extractBlock(xml, "select", "selectpage"), xml);
        String detail = expandSqlIncludes(extractBlock(xml, "select", "selectdetail"), xml);

        assertThat(page)
                .contains("group_resource.resource_biz_type = 'skill_group'")
                .contains("group_resource.com_acct_id = #{comacctid}")
                .contains("group_resource.com_acct_id is null")
                .contains("group_resource.owner_type is null")
                .contains("group_resource.owner_type != 'personal'")
                .contains("group_resource.create_by = #{currentuserid}")
                .contains("member_rel.rel_type_name = 'skill_group_member'")
                .contains("member_rel.rel_status = 1")
                .contains("<if test=\"qo.keyword != null and qo.keyword != ''\">")
                .contains("group_resource.resource_name like concat('%', #{qo.keyword}, '%')")
                .contains("<if test=\"qo.ownertype != null and qo.ownertype != ''\">")
                .contains("group_resource.owner_type = #{qo.ownertype}")
                .contains("<if test=\"qo.resourcestatus != null\">")
                .contains("group_resource.resource_status = #{qo.resourcestatus}")
                .contains("<if test=\"qo.catalogid != null\">")
                .contains("group_resource.catalog_id = #{qo.catalogid}")
                .contains("group_resource.update_time desc nulls last")
                .contains("group_resource.resource_id desc");

        assertThat(detail)
                .contains("group_resource.resource_biz_type = 'skill_group'")
                .contains("group_resource.com_acct_id = #{comacctid}")
                .contains("group_resource.com_acct_id is null")
                .contains("group_resource.owner_type is null")
                .contains("group_resource.owner_type != 'personal'")
                .contains("group_resource.create_by = #{currentuserid}");
    }

    @Test
    void memberCountJoinsExistingSkillTargetsWithoutFilteringTheirStatus() throws Exception {
        String columns = extractBlock(readMapperXml(), "sql", "skillgroupcolumns");

        assertThat(columns)
                .contains("join ss_resource member_count_resource")
                .contains("member_count_resource.resource_id = member_rel.rel_resource_id")
                .contains("member_count_resource.resource_biz_type = 'skill'")
                .doesNotContain("member_count_resource.resource_status");
    }

    @Test
    void activeMemberStatementContainsOnlyActiveSkillGroupMembersAndSkillExtensionJoin() throws Exception {
        String activeMembers = extractBlock(readMapperXml(), "select", "selectactivemembers");

        assertThat(activeMembers)
                .contains("member_rel.rel_type_name = 'skill_group_member'")
                .contains("member_rel.rel_status = 1")
                .contains("member_resource.resource_biz_type = 'skill'")
                .contains("member_resource.create_by")
                .contains("left join ss_res_ext_skill skill_ext");
    }

    @Test
    void memberCandidateStatementFiltersOnBackendByTenantOwnerStatusTypeAndOriginalCreator() throws Exception {
        String candidates = extractBlock(readMapperXml(), "select", "selectmembercandidates");

        assertThat(candidates)
                .contains("skill_resource.com_acct_id = #{comacctid}")
                .contains("skill_resource.resource_biz_type = 'skill'")
                .contains("skill_resource.resource_status = 2")
                .contains("skill_resource.owner_type = 'enterprise' and lower(skill_ext.skill_type) = 'inner'")
                .contains("skill_resource.owner_type in ('enterprise', 'personal')")
                .contains("and skill_resource.create_by = #{creatorid}")
                .contains("case when skill_resource.owner_type = 'enterprise' and lower(skill_ext.skill_type) = 'inner'")
                .contains("as system_built_in")
                .contains("as creator_owned")
                .contains("upper(skill_resource.resource_code)")
                .contains("upper(skill_resource.resource_name)")
                .contains("skill_resource.update_time desc nulls last")
                .contains("skill_resource.resource_id desc");
    }

    @Test
    void relationStatementsScopeTypesStatusesAndOptionalSkillFilters() throws Exception {
        String xml = readMapperXml();
        String memberRelations = expandSqlIncludes(extractBlock(xml, "select", "selectmemberrelations"), xml);
        String employeeRelations =
                expandSqlIncludes(extractBlock(xml, "select", "selectdigitalemployeeskillrelations"), xml);

        assertThat(memberRelations)
                .contains("relation.resource_id = #{groupid}")
                .contains("relation.rel_type_name = 'skill_group_member'")
                .contains("relation.rel_status = 1")
                .contains("<if test=\"skillids != null and skillids.size() > 0\">")
                .contains("relation.rel_resource_id in")
                .contains("<foreach collection=\"skillids\"");

        assertThat(employeeRelations)
                .contains("relation.resource_id = #{digitalemployeeid}")
                .contains("relation.rel_type_name = 'dig_employee_skill'")
                .contains("rel_status = 1")
                .contains("<if test=\"skillids != null and skillids.size() > 0\">")
                .contains("relation.rel_resource_id in")
                .contains("<foreach collection=\"skillids\"");
    }

    @Test
    void candidateSourceStatementIsActiveAndNeverCastsLegacySourceInfo() throws Exception {
        String candidates =
                extractBlock(readMapperXml(), "select", "selectskillrelationswithsourceinfo");

        assertThat(candidates)
                .contains("relation.rel_type_name = 'dig_employee_skill'")
                .contains("relation.rel_status = 1")
                .contains("relation.rel_resource_info is not null")
                .doesNotContain("::json")
                .doesNotContain("::jsonb");
    }

    @Test
    void tenantCandidateSourceStatementUsesAuthoritativeDigitalEmployeeTenant() throws Exception {
        String candidates = expandSqlIncludes(
                extractBlock(readMapperXml(), "select", "selectskillrelationswithsourceinfobytenant"),
                readMapperXml());

        assertThat(candidates)
                .contains("relation.resource_rel_detail_id")
                .contains("relation.rel_resource_info")
                .contains("join ss_resource employee")
                .contains("employee.resource_id = relation.resource_id")
                .contains("employee.resource_biz_type = 'dig_employee'")
                .contains("employee.com_acct_id = #{comacctid}")
                .doesNotContain("relation.com_acct_id = #{comacctid}")
                .doesNotContain("relation.create_by")
                .doesNotContain("relation.update_by")
                .doesNotContain("relation.rel_resource_id");

        Configuration configuration = buildMapperConfiguration();
        String boundSql = normalizedBoundSql(configuration, "selectSkillRelationsWithSourceInfoByTenant",
                Map.of("comAcctId", 60001L)).getSql();
        assertThat(boundSql)
                .contains("join ss_resource employee")
                .contains("employee.resource_id = relation.resource_id")
                .contains("employee.resource_biz_type = 'dig_employee'")
                .contains("employee.com_acct_id = ?")
                .doesNotContain("relation.com_acct_id = ?");
    }

    @Test
    void inactiveMemberMutationStatementReturnsNoRowsForNullOrEmptyIds() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("groupId", 10001L);
        parameters.put("skillIds", null);
        assertThat(normalizedBoundSql(configuration, "selectMemberRelationsIncludingInactive", parameters).getSql())
                .contains("1 = 0");

        parameters.put("skillIds", List.of());
        assertThat(normalizedBoundSql(configuration, "selectMemberRelationsIncludingInactive", parameters).getSql())
                .contains("1 = 0");
    }

    @Test
    void installedSkillIdStatementIsDistinctActiveEmployeeScopedAndSafeForEmptyIds() throws Exception {
        String statement = extractBlock(readMapperXml(), "select", "selectinstalledskillids");
        assertThat(statement)
                .contains("select distinct relation.rel_resource_id")
                .contains("join ss_resource employee")
                .contains("employee.resource_id = relation.resource_id")
                .contains("relation.resource_id = #{digitalemployeeid}")
                .contains("employee.com_acct_id = #{tenantid}")
                .contains("employee.resource_biz_type = 'dig_employee'")
                .contains("join ss_resource skill_resource")
                .contains("skill_resource.com_acct_id = #{tenantid}")
                .contains("skill_resource.resource_biz_type = 'skill'")
                .contains("relation.rel_type_name = 'dig_employee_skill' or relation.rel_type_name is null")
                .contains("relation.rel_status = 1 or relation.rel_status is null")
                .contains("relation.rel_resource_id in")
                .contains("<foreach collection=\"skillids\"")
                .contains("<otherwise>")
                .contains("1 = 0");

        Configuration configuration = buildMapperConfiguration();
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("digitalEmployeeId", 30001L);
        parameters.put("tenantId", 60001L);
        parameters.put("skillIds", null);
        assertThat(normalizedBoundSql(configuration, "selectInstalledSkillIds", parameters).getSql())
                .contains("1 = 0");

        parameters.put("skillIds", List.of());
        assertThat(normalizedBoundSql(configuration, "selectInstalledSkillIds", parameters).getSql())
                .contains("1 = 0");

        parameters.put("skillIds", List.of(20001L, 20002L));
        BoundSql populated = normalizedBoundSql(configuration, "selectInstalledSkillIds", parameters);
        assertThat(populated.getSql()).containsPattern("relation\\.rel_resource_id in \\( \\? , \\? \\)");
        assertThat(populated.getParameterMappings()).hasSize(5);
    }

    @Test
    void activeSkillBatchLockIsTenantTypeStatusGuardedSortedAndForUpdate() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("skillIds", List.of(20002L, 20001L));
        parameters.put("comAcctId", 60001L);

        String sql = normalizedBoundSql(configuration, "selectActiveSkillsForUpdate", parameters).getSql();

        assertThat(sql)
                .contains("skill_resource.resource_id in ( ? , ? )")
                .contains("skill_resource.com_acct_id = ?")
                .contains("skill_resource.resource_biz_type = 'skill'")
                .contains("skill_resource.resource_status = 2")
                .contains("order by skill_resource.resource_id asc")
                .endsWith("for update");
    }

    @Test
    void groupLockAndScopedUpdateBoundSqlAreTenantAndTypeGuarded() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        String lockSql = normalizedBoundSql(configuration, "selectGroupForUpdate", Map.of(
                "groupId", 10001L, "comAcctId", 60001L)).getSql();
        assertThat(lockSql)
                .contains("resource_id = ?")
                .contains("com_acct_id = ?")
                .contains("resource_biz_type = 'skill_group'")
                .endsWith("for update");

        SsResource group = new SsResource();
        group.setResourceId(10001L);
        group.setResourceName("updated");
        group.setResourceDesc("desc");
        group.setAvatar("avatar");
        group.setCatalogId(40001L);
        group.setUpdateBy(50001L);
        group.setUpdateTime(new Date(1_000L));
        String updateSql = normalizedBoundSql(configuration, "updateGroupFields", Map.of(
                "group", group, "comAcctId", 60001L)).getSql();
        assertThat(updateSql)
                .contains("resource_name = ?")
                .contains("resource_desc = ?")
                .contains("avatar = ?")
                .contains("catalog_id = ?")
                .contains("update_by = ?")
                .contains("update_time = ?")
                .contains("resource_id = ?")
                .contains("com_acct_id = ?")
                .contains("resource_biz_type = 'skill_group'")
                .doesNotContain("owner_type =")
                .doesNotContain("resource_status =");
    }

    @Test
    void employeeLockAndSkillRelationSqlAreScopedLegacySafeAndAvoidJsonCasts() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        String lockSql = normalizedBoundSql(configuration, "selectDigitalEmployeeForUpdate", Map.of(
                "digitalEmployeeId", 30001L, "comAcctId", 60001L)).getSql();
        assertThat(lockSql)
                .contains("resource_id = ?")
                .contains("com_acct_id = ?")
                .contains("resource_biz_type = 'dig_employee'")
                .endsWith("for update");

        Map<String, Object> allParameters = new HashMap<>();
        allParameters.put("digitalEmployeeId", 30001L);
        allParameters.put("skillIds", null);
        String allRelations = normalizedBoundSql(
                configuration, "selectDigitalEmployeeSkillRelations", allParameters).getSql();
        assertThat(allRelations)
                .contains("join ss_resource skill_resource")
                .contains("skill_resource.resource_id = relation.rel_resource_id")
                .contains("skill_resource.resource_biz_type = 'skill'")
                .contains("relation.rel_type_name = 'dig_employee_skill'")
                .contains("relation.rel_type_name is null")
                .contains("relation.rel_status = 1")
                .contains("relation.rel_status is null")
                .doesNotContain("::json")
                .doesNotContain("::jsonb")
                .doesNotContain("cast(");

        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(90001L);
        relation.setResourceId(30001L);
        relation.setRelResourceId(20001L);
        relation.setRelResourceInfo("{\"manual\":false,\"sourceGroupIds\":[10001]}");
        relation.setCreateBy(50001L);
        relation.setCreateTime(new Date(1_000L));
        relation.setUpdateBy(50001L);
        relation.setUpdateTime(new Date(1_000L));
        relation.setComAcctId(60001L);
        relation.setRelTypeName("DIG_EMPLOYEE_SKILL");
        relation.setRelStatus(1);
        String insertSql = normalizedBoundSql(configuration, "insertDigitalEmployeeSkillIfAbsent",
                Map.of("relation", relation)).getSql();
        assertThat(insertSql)
                .startsWith("merge into ss_resource_rel_detail target")
                .contains("when not matched then insert")
                .doesNotContain("on conflict");
    }

    @Test
    void activeMemberInsertAlwaysUsesOpenGaussMergeSql() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail relation =
                new com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail();
        relation.setResourceRelDetailId(70001L);
        relation.setResourceId(10001L);
        relation.setRelResourceId(20001L);
        relation.setCreateBy(50001L);
        relation.setCreateTime(new Date(1_000L));
        relation.setUpdateBy(50001L);
        relation.setUpdateTime(new Date(1_000L));
        relation.setComAcctId(60001L);
        relation.setRelTypeName("SKILL_GROUP_MEMBER");
        relation.setRelStatus(1);

        String sql = normalizedBoundSql(
                configuration, "insertActiveMemberIfAbsent", Map.of("relation", relation)).getSql();

        assertThat(sql)
                .startsWith("merge into ss_resource_rel_detail target")
                .contains("when not matched then insert")
                .doesNotContain("on conflict");
    }

    @Test
    void openGaussUsesMergeForDigitalEmployeeSkillInsert() throws Exception {
        Configuration configuration = buildMapperConfiguration("opengauss");
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(90001L);
        relation.setResourceId(30001L);
        relation.setRelResourceId(20001L);
        relation.setCreateBy(50001L);
        relation.setCreateTime(new Date(1_000L));
        relation.setUpdateBy(50001L);
        relation.setUpdateTime(new Date(1_000L));
        relation.setComAcctId(60001L);
        relation.setRelTypeName("DIG_EMPLOYEE_SKILL");
        relation.setRelStatus(1);

        String sql = normalizedBoundSql(configuration, "insertDigitalEmployeeSkillIfAbsent",
                Map.of("relation", relation)).getSql();
        assertThat(sql)
                .startsWith("merge into ss_resource_rel_detail target")
                .contains("when not matched then insert")
                .doesNotContain("on conflict");
    }

    @Test
    void openGaussUsesMergeForActiveMemberInsert() throws Exception {
        Configuration configuration = buildMapperConfiguration("opengauss");
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(70001L);
        relation.setResourceId(10001L);
        relation.setRelResourceId(20001L);
        relation.setCreateBy(50001L);
        relation.setCreateTime(new Date(1_000L));
        relation.setUpdateBy(50001L);
        relation.setUpdateTime(new Date(1_000L));
        relation.setComAcctId(60001L);
        relation.setRelTypeName("SKILL_GROUP_MEMBER");
        relation.setRelStatus(1);

        String sql = normalizedBoundSql(
                configuration, "insertActiveMemberIfAbsent", Map.of("relation", relation)).getSql();
        assertThat(sql)
                .startsWith("merge into ss_resource_rel_detail target")
                .contains("when not matched then insert")
                .doesNotContain("on conflict");
    }

    @Test
    void mapperXmlBuildsAndRegistersAllStatements() throws Exception {
        Configuration configuration = buildMapperConfiguration();

        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectPage")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectDetail")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectActiveMembers")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectMemberRelations")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectDigitalEmployeeSkillRelations")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectInstalledSkillIds")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectSkillRelationsWithSourceInfo")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectSkillRelationsWithSourceInfoByTenant")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectMemberRelationsIncludingInactive")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectGroupForUpdate")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectDigitalEmployeeForUpdate")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "selectActiveSkillsForUpdate")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "updateGroupFields")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "insertActiveMemberIfAbsent")).isTrue();
        assertThat(configuration.hasStatement(MAPPER_NAMESPACE + "insertDigitalEmployeeSkillIfAbsent")).isTrue();
    }

    @Test
    void boundSqlBuildsForPageDetailAndActiveMemberStatements() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        SkillGroupPageQo pageQo = new SkillGroupPageQo();
        pageQo.setKeyword("analysis");
        pageQo.setOwnerType("enterprise");
        pageQo.setResourceStatus(1);
        pageQo.setCatalogId(40001L);

        Map<String, Object> pageParameters = new HashMap<>();
        pageParameters.put("qo", pageQo);
        pageParameters.put("comAcctId", null);
        pageParameters.put("currentUserId", 50001L);
        String pageSql = normalizedBoundSql(configuration, "selectPage", pageParameters).getSql();
        assertThat(pageSql)
                .contains("group_resource.com_acct_id is null")
                .contains("group_resource.owner_type is null")
                .contains("group_resource.resource_name like concat('%', ?, '%')")
                .contains("group_resource.owner_type = ?")
                .contains("group_resource.resource_status = ?")
                .contains("group_resource.catalog_id = ?");

        Map<String, Object> detailParameters = new HashMap<>();
        detailParameters.put("groupId", 10001L);
        detailParameters.put("comAcctId", 60001L);
        detailParameters.put("currentUserId", 50001L);
        String detailSql = normalizedBoundSql(configuration, "selectDetail", detailParameters).getSql();
        assertThat(detailSql)
                .contains("group_resource.resource_id = ?")
                .contains("group_resource.com_acct_id = ?")
                .contains("group_resource.owner_type is null")
                .contains("left join po_users creator")
                .contains("as creator_name")
                .doesNotContain("cast(group_resource.create_by")
                .doesNotContain("group_resource.create_by as creator_name");

        String memberSql = normalizedBoundSql(configuration, "selectActiveMembers", Map.of("groupId", 10001L))
                .getSql();
        assertThat(memberSql)
                .contains("member_rel.resource_id = ?")
                .contains("member_rel.rel_type_name = 'skill_group_member'")
                .contains("member_resource.resource_biz_type = 'skill'");
    }

    @Test
    void boundSqlOmitsOptionalRelationIdFilterForNullAndEmptyListsAndExpandsPopulatedLists() throws Exception {
        Configuration configuration = buildMapperConfiguration();

        assertOptionalRelationListShapes(configuration, "selectMemberRelations", "groupId");
        assertOptionalRelationListShapes(
                configuration, "selectDigitalEmployeeSkillRelations", "digitalEmployeeId");
    }

    @Test
    void activeMemberRelationQueryHasDeterministicMembershipOrder() throws Exception {
        Configuration configuration = buildMapperConfiguration();
        Map<String, Object> parameters = new HashMap<>();
        parameters.put("groupId", 10001L);
        parameters.put("skillIds", null);

        String sql = normalizedBoundSql(configuration, "selectMemberRelations", parameters).getSql();

        assertThat(sql).endsWith("order by relation.create_time, relation.resource_rel_detail_id");
    }

    private static void assertInvalidProperties(Object value, String... expectedProperties) {
        List<String> invalidProperties = VALIDATOR.validate(value).stream()
                .map(ConstraintViolation::getPropertyPath)
                .map(Object::toString)
                .toList();

        for (String expectedProperty : expectedProperties) {
            assertThat(invalidProperties)
                    .anyMatch(property -> property.equals(expectedProperty)
                            || property.startsWith(expectedProperty + "["));
        }
    }

    private static void assertTextualArrayEntry(JsonNode json, String field, String expectedValue) {
        assertThat(json.path(field).isArray()).isTrue();
        assertThat(json.path(field).path(0).isTextual()).isTrue();
        assertThat(json.path(field).path(0).asText()).isEqualTo(expectedValue);
    }

    private static Configuration buildMapperConfiguration() throws Exception {
        Configuration configuration = new Configuration();
        try (InputStream input = Resources.getResourceAsStream(MAPPER_RESOURCE)) {
            XMLMapperBuilder builder =
                    new XMLMapperBuilder(input, configuration, MAPPER_RESOURCE, configuration.getSqlFragments());
            builder.parse();
        }
        return configuration;
    }

    private static Configuration buildMapperConfiguration(String databaseId) throws Exception {
        Configuration configuration = new Configuration();
        configuration.setDatabaseId(databaseId);
        try (InputStream input = Resources.getResourceAsStream(MAPPER_RESOURCE)) {
            XMLMapperBuilder builder =
                    new XMLMapperBuilder(input, configuration, MAPPER_RESOURCE, configuration.getSqlFragments());
            builder.parse();
        }
        return configuration;
    }

    private static BoundSql normalizedBoundSql(
            Configuration configuration, String statementId, Map<String, Object> parameters) {
        BoundSql boundSql = configuration
                .getMappedStatement(MAPPER_NAMESPACE + statementId)
                .getBoundSql(parameters);
        return new BoundSql(
                configuration,
                normalizeWhitespace(boundSql.getSql()),
                boundSql.getParameterMappings(),
                parameters);
    }

    private static void assertOptionalRelationListShapes(
            Configuration configuration, String statementId, String resourceIdParameter) {
        Map<String, Object> parameters = new HashMap<>();
        parameters.put(resourceIdParameter, 10001L);
        parameters.put("skillIds", null);
        BoundSql nullList = normalizedBoundSql(configuration, statementId, parameters);
        assertThat(nullList.getSql()).doesNotContain("relation.rel_resource_id in");
        assertThat(nullList.getParameterMappings()).hasSize(1);

        parameters.put("skillIds", List.of());
        BoundSql emptyList = normalizedBoundSql(configuration, statementId, parameters);
        assertThat(emptyList.getSql()).doesNotContain("relation.rel_resource_id in");
        assertThat(emptyList.getParameterMappings()).hasSize(1);

        parameters.put("skillIds", List.of(20001L, 20002L));
        BoundSql populatedList = normalizedBoundSql(configuration, statementId, parameters);
        assertThat(populatedList.getSql())
                .containsPattern("relation\\.rel_resource_id in \\( \\? , \\? \\)");
        assertThat(populatedList.getParameterMappings()).hasSize(3);
    }

    private static String readMapperXml() throws Exception {
        try (InputStream input = Resources.getResourceAsStream(MAPPER_RESOURCE)) {
            return new String(input.readAllBytes(), StandardCharsets.UTF_8)
                    .toLowerCase(Locale.ROOT)
                    .transform(SkillGroupContractTest::normalizeWhitespace);
        }
    }

    private static String normalizeWhitespace(String value) {
        return value.toLowerCase(Locale.ROOT).replaceAll("\\s+", " ").trim();
    }

    private static String extractBlock(String xml, String tag, String id) {
        Pattern pattern = Pattern.compile(
                "<" + tag + "\\b(?=[^>]*\\bid=\\\"" + Pattern.quote(id) + "\\\")[^>]*>.*?</" + tag + ">");
        Matcher matcher = pattern.matcher(xml);
        assertThat(matcher.find()).as("mapper contains %s block %s", tag, id).isTrue();
        return matcher.group();
    }

    private static String expandSqlIncludes(String block, String xml) {
        Pattern includePattern = Pattern.compile("<include\\s+refid=\\\"([^\\\"]+)\\\"\\s*/>");
        String expanded = block;
        while (includePattern.matcher(expanded).find()) {
            Matcher matcher = includePattern.matcher(expanded);
            StringBuffer buffer = new StringBuffer();
            while (matcher.find()) {
                String sqlBlock = extractBlock(xml, "sql", matcher.group(1));
                String sqlBody = sqlBlock.replaceFirst("^<sql\\b[^>]*>", "").replaceFirst("</sql>$", "");
                matcher.appendReplacement(buffer, Matcher.quoteReplacement(sqlBody));
            }
            matcher.appendTail(buffer);
            expanded = buffer.toString();
        }
        return expanded;
    }
}
