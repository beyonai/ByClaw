package com.iwhalecloud.byai.manager.mapper.resource;

import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupPageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCandidatePageQo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupVo;
import java.util.List;
import org.apache.ibatis.annotations.Mapper;
import org.apache.ibatis.annotations.Param;

@Mapper
public interface SkillGroupMapper {

    /**
     * Locks one tenant-owned skill-group row for update. Task 5 install/uninstall operations must acquire this same
     * database row lock before reading or changing installed group sources.
     *
     * @param groupId skill-group resource ID
     * @param comAcctId current tenant ID
     * @return locked skill-group row, or {@code null} when the ID/type/tenant scope does not match
     */
    SsResource selectGroupForUpdate(
            @Param("groupId") Long groupId, @Param("comAcctId") Long comAcctId);

    /**
     * Locks one tenant-owned digital employee row before snapshot relation reads and mutations. Serializing on the
     * employee resource prevents duplicate direct skill rows and install/uninstall races even though the historical
     * schema has no employee-skill unique constraint.
     *
     * @param digitalEmployeeId digital-employee resource ID
     * @param comAcctId current tenant ID
     * @return locked digital employee, or {@code null} when ID/type/tenant does not match
     */
    SsResource selectDigitalEmployeeForUpdate(
            @Param("digitalEmployeeId") Long digitalEmployeeId,
            @Param("comAcctId") Long comAcctId);

    /**
     * Locks active tenant-owned skill rows in ascending resource-ID order.
     *
     * @param skillIds exact skill IDs to lock
     * @param comAcctId current tenant ID
     * @return matching locked active skills ordered by resource ID
     */
    List<SsResource> selectActiveSkillsForUpdate(
            @Param("skillIds") List<Long> skillIds,
            @Param("comAcctId") Long comAcctId);

    /**
     * Updates only editable skill-group columns and audit fields under ID, tenant, and SKILL_GROUP guards.
     *
     * @param group values to persist
     * @param comAcctId current tenant ID
     * @return affected row count
     */
    int updateGroupFields(@Param("group") SsResource group, @Param("comAcctId") Long comAcctId);

    /**
     * Inserts one active skill-group membership without raising a duplicate-key error when the matching active
     * partial-unique key already exists.
     *
     * @param relation active membership row to insert
     * @return {@code 1} when inserted, {@code 0} when an active row already exists
     */
    int insertActiveMemberIfAbsent(@Param("relation") SsResourceRelDetail relation);

    List<SkillGroupVo> selectPage(
            @Param("qo") SkillGroupPageQo qo,
            @Param("comAcctId") Long comAcctId,
            @Param("currentUserId") Long currentUserId);

    SkillGroupVo selectDetail(
            @Param("groupId") Long groupId,
            @Param("comAcctId") Long comAcctId,
            @Param("currentUserId") Long currentUserId);

    List<SkillGroupMemberVo> selectActiveMembers(@Param("groupId") Long groupId);

    List<SkillGroupMemberVo> selectMemberCandidates(
            @Param("qo") SkillGroupCandidatePageQo qo,
            @Param("comAcctId") Long comAcctId,
            @Param("creatorId") Long creatorId);

    /**
     * Selects active group-member relations, optionally restricted to skill IDs.
     *
     * @param groupId skill-group resource ID
     * @param skillIds skill IDs to filter; {@code null} or empty selects all matching relations
     * @return matching active group-member relations
     */
    List<SsResourceRelDetail> selectMemberRelations(
            @Param("groupId") Long groupId, @Param("skillIds") List<Long> skillIds);

    /**
     * Selects active and inactive membership rows for the supplied skill IDs. Null or empty IDs deliberately return
     * no rows so mutation callers can never accidentally select every group member.
     *
     * @param groupId skill-group resource ID
     * @param skillIds exact member skill IDs; null or empty returns no rows
     * @return matching membership rows
     */
    List<SsResourceRelDetail> selectMemberRelationsIncludingInactive(
            @Param("groupId") Long groupId, @Param("skillIds") List<Long> skillIds);

    /**
     * Selects active digital-employee skill relations, optionally restricted to skill IDs.
     *
     * @param digitalEmployeeId digital-employee resource ID
     * @param skillIds skill IDs to filter; {@code null} or empty selects all matching relations
     * @return matching active digital-employee skill relations
     */
    List<SsResourceRelDetail> selectDigitalEmployeeSkillRelations(
            @Param("digitalEmployeeId") Long digitalEmployeeId,
            @Param("skillIds") List<Long> skillIds);

    List<SsResourceRelDetail> selectActiveEmployeeSkillRelationsBySkill(
            @Param("skillId") Long skillId,
            @Param("comAcctId") Long comAcctId);

    /**
     * Selects the distinct active skill IDs installed for one digital employee. Null or empty skill IDs deliberately
     * return no rows; callers must also skip the query when no IDs need evaluation.
     *
     * @param digitalEmployeeId digital-employee resource ID
     * @param tenantId current tenant ID
     * @param skillIds exact skill IDs to check
     * @return distinct installed skill IDs
     */
    List<Long> selectInstalledSkillIds(
            @Param("digitalEmployeeId") Long digitalEmployeeId,
            @Param("tenantId") Long tenantId,
            @Param("skillIds") List<Long> skillIds);

    /**
     * Inserts a canonical direct employee-skill relation and tolerates any database uniqueness conflict. Callers
     * must hold {@link #selectDigitalEmployeeForUpdate(Long, Long)} because historical deployments do not have a
     * dedicated employee-skill unique constraint.
     *
     * @param relation canonical employee-skill relation
     * @return {@code 1} when inserted, otherwise {@code 0}
     */
    int insertDigitalEmployeeSkillIfAbsent(@Param("relation") SsResourceRelDetail relation);

    List<SsResourceRelDetail> selectSkillRelationsWithSourceInfo();

    /**
     * Selects only relation identity and source metadata for active digital-employee skill relations in one tenant.
     * Source JSON is intentionally not cast or prefiltered so Java parsing preserves legacy/manual deletion semantics.
     *
     * @param comAcctId current tenant ID
     * @return candidate source rows
     */
    List<SsResourceRelDetail> selectSkillRelationsWithSourceInfoByTenant(
            @Param("comAcctId") Long comAcctId);
}
