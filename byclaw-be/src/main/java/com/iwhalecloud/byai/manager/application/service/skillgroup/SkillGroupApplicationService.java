package com.iwhalecloud.byai.manager.application.service.skillgroup;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.model.SkillRelationSource;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtSkill;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCreateQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupCandidatePageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupIdQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupInstallQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupMemberChangeQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupPageQo;
import com.iwhalecloud.byai.manager.qo.skillgroup.SkillGroupUpdateQo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupInstallResultVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 技能组采用安装快照语义：成员变化只影响技能组当前配置，不自动传播到已经安装该组的数字员工。
 * 安装时展开为数字员工到普通技能的直接关系；卸载时按来源精确移除，避免误删手工或其他技能组来源。
 */
@Service
public class SkillGroupApplicationService {

    private static final String SKILL_GROUP = ResourceBizTypeEnum.SKILL_GROUP.name();
    private static final String SKILL = ResourceBizTypeEnum.SKILL.name();
    private static final String RESOURCE_TYPE_COMBIN = "COMBIN";
    private static final String ADMIN_VIP_USER_CODE = "adminvip";
    private static final String USER_CODE_CONFIG = "USERCODE_CONFIG";
    private static final String MEMBER_REL_TYPE = "SKILL_GROUP_MEMBER";

    private final SsResourceService resourceService;
    private final SsResourceRelDetailService relationService;
    private final SkillGroupMapper skillGroupMapper;
    private final AuthApplicationService authApplicationService;
    private final SequenceService sequenceService;
    private final DigitalEmployeeApplicationService digitalEmployeeApplicationService;
    private final SsResExtSkillService extSkillService;
    private final ByaiSystemConfigService systemConfigService;

    public SkillGroupApplicationService(
            SsResourceService resourceService,
            SsResourceRelDetailService relationService,
            SkillGroupMapper skillGroupMapper,
            AuthApplicationService authApplicationService,
            SequenceService sequenceService,
            DigitalEmployeeApplicationService digitalEmployeeApplicationService,
            SsResExtSkillService extSkillService,
            ByaiSystemConfigService systemConfigService) {
        this.resourceService = resourceService;
        this.relationService = relationService;
        this.skillGroupMapper = skillGroupMapper;
        this.authApplicationService = authApplicationService;
        this.sequenceService = sequenceService;
        this.digitalEmployeeApplicationService = digitalEmployeeApplicationService;
        this.extSkillService = extSkillService;
        this.systemConfigService = systemConfigService;
    }

    public SkillGroupVo create(SkillGroupCreateQo qo) {
        Long tenantId = requireCurrentTenant();
        requireAdminVipCreatePermission();
        SsResource resource = new SsResource();
        resource.setResourceBizType(SKILL_GROUP);
        resource.setResourceType(RESOURCE_TYPE_COMBIN);
        resource.setResourceStatus(ResourceStatus.LIST.getNum());
        resource.setOwnerType(qo.getOwnerType());
        resource.setResourceName(qo.getResourceName());
        resource.setResourceDesc(qo.getResourceDesc());
        resource.setAvatar(qo.getAvatar());
        resource.setCatalogId(qo.getCatalogId());
        resource.setComAcctId(tenantId);
        return toVo(resourceService.saveResource(resource));
    }

    @Transactional(rollbackFor = Exception.class)
    public SkillGroupVo update(SkillGroupUpdateQo qo) {
        SsResource group = loadManagedGroupForUpdate(qo.getGroupId());
        group.setResourceName(qo.getResourceName());
        group.setResourceDesc(qo.getResourceDesc());
        group.setAvatar(qo.getAvatar());
        group.setCatalogId(qo.getCatalogId());
        group.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        group.setUpdateTime(new Date());
        if (skillGroupMapper.updateGroupFields(group, group.getComAcctId()) == 0) {
            throw new BaseException("技能组已被并发修改或删除，请刷新后重试");
        }
        return toVo(group);
    }

    public PageInfo<SkillGroupVo> page(SkillGroupPageQo qo) {
        Long tenantId = requireCurrentTenant();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        List<SkillGroupVo> rows = skillGroupMapper.selectPage(qo, tenantId, currentUserId);
        return PageHelperUtil.toPageInfo(new com.github.pagehelper.PageInfo<>(rows));
    }

    public PageInfo<SkillGroupMemberVo> pageMemberCandidates(SkillGroupCandidatePageQo qo) {
        Long tenantId = requireCurrentTenant();
        Long creatorId = CurrentUserHolder.getCurrentUserId();
        if (qo.getGroupId() != null) {
            creatorId = loadManagedGroup(qo.getGroupId(), tenantId).getCreateBy();
        }
        PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        List<SkillGroupMemberVo> rows = skillGroupMapper.selectMemberCandidates(qo, tenantId, creatorId);
        return PageHelperUtil.toPageInfo(new com.github.pagehelper.PageInfo<>(rows));
    }

    public SkillGroupVo detail(SkillGroupIdQo qo) {
        return detail(qo.getGroupId());
    }

    public SkillGroupVo detail(Long groupId) {
        SkillGroupVo group = skillGroupMapper.selectDetail(
                groupId, requireCurrentTenant(), CurrentUserHolder.getCurrentUserId());
        if (group == null) {
            throw new BaseException("技能组不存在或当前用户不可访问");
        }
        group.setMembers(skillGroupMapper.selectActiveMembers(groupId));
        return group;
    }

    /**
     * 安装技能组当前活跃成员快照。后续成员增删不会自动传播；数字员工只获得安装时成员的直接技能关系，
     * 并记录本技能组来源。技能组锁与删除共享，数字员工锁用于串行化直接技能关系变更。
     *
     * @param qo 数字员工与技能组标识
     * @return 当前快照、全新安装和已有直接关系的技能标识
     */
    @Transactional(rollbackFor = Exception.class)
    public SkillGroupInstallResultVo install(SkillGroupInstallQo qo) {
        validateInstallRequest(qo);
        Long tenantId = requireCurrentTenant();
        SsResource group = loadAccessibleGroupForSnapshot(qo.getGroupId(), tenantId);
        SsResource digitalEmployee = loadManagedDigitalEmployeeForSnapshot(
                qo.getDigitalEmployeeId(), tenantId, group);

        List<SsResourceRelDetail> memberRelations =
                skillGroupMapper.selectMemberRelations(group.getResourceId(), null);
        List<Long> skillIds = memberRelations == null ? List.of() : memberRelations.stream()
                .map(SsResourceRelDetail::getRelResourceId)
                .filter(Objects::nonNull)
                .distinct()
                .toList();
        if (skillIds.isEmpty()) {
            throw new BaseException("技能组没有可安装的活跃成员");
        }
        validateMemberSkills(group, skillIds);

        SkillGroupInstallResultVo result = digitalEmployeeApplicationService.installSkillGroupSnapshot(
                digitalEmployee, group.getResourceId(), skillIds);
        if (result == null) {
            throw new BaseException("技能组安装结果异常");
        }
        result.setTotalSkillIds(new ArrayList<>(skillIds));
        return result;
    }

    /**
     * 仅卸载指定技能组来源，不读取当前成员，也不删除技能资源或工作区技能包。手工来源或其他技能组来源
     * 仍存在时保留数字员工直接技能关系；成员变化不会自动传播到既有安装快照。
     *
     * @param qo 数字员工与技能组标识
     * @return 卸载前受影响、已移除和仍保留的技能标识
     */
    @Transactional(rollbackFor = Exception.class)
    public SkillGroupInstallResultVo uninstall(SkillGroupInstallQo qo) {
        validateInstallRequest(qo);
        Long tenantId = requireCurrentTenant();
        SsResource group = loadAccessibleGroupForSnapshot(qo.getGroupId(), tenantId);
        SsResource digitalEmployee = loadManagedDigitalEmployeeForSnapshot(
                qo.getDigitalEmployeeId(), tenantId, group);
        SkillGroupInstallResultVo result = digitalEmployeeApplicationService.uninstallSkillGroupSnapshot(
                digitalEmployee, group.getResourceId());
        if (result == null) {
            throw new BaseException("技能组卸载结果异常");
        }
        return result;
    }

    /**
     * 增加成员只更新技能组当前配置，不会传播到已经安装该组的数字员工。
     *
     * @param qo 技能组及待增加技能
     */
    @Transactional(rollbackFor = Exception.class)
    public void addMembers(SkillGroupMemberChangeQo qo) {
        List<Long> skillIds = normalizeRequiredIds(qo.getSkillIds());
        SsResource group = loadManagedGroupForUpdate(qo.getGroupId());
        validateMemberSkills(group, skillIds);

        List<SsResourceRelDetail> existing = skillGroupMapper.selectMemberRelationsIncludingInactive(
                group.getResourceId(), skillIds);
        Map<Long, List<SsResourceRelDetail>> bySkillId = new LinkedHashMap<>();
        for (SsResourceRelDetail relation : existing) {
            bySkillId.computeIfAbsent(relation.getRelResourceId(), ignored -> new ArrayList<>()).add(relation);
        }

        Date now = new Date();
        Long userId = CurrentUserHolder.getCurrentUserId();
        for (Long skillId : skillIds) {
            List<SsResourceRelDetail> skillRelations = bySkillId.getOrDefault(skillId, List.of());
            if (skillRelations.stream().anyMatch(relation -> Objects.equals(1, relation.getRelStatus()))) {
                continue;
            }
            SsResourceRelDetail inactive = skillRelations.stream().findFirst().orElse(null);
            if (inactive != null) {
                inactive.setRelStatus(1);
                inactive.setUpdateBy(userId);
                inactive.setUpdateTime(now);
                if (!relationService.updateById(inactive) && !isMemberActive(group.getResourceId(), skillId)) {
                    throw new BaseException("技能组成员已被并发修改，请刷新后重试");
                }
                continue;
            }
            insertMemberRelationIfAbsent(group, skillId, userId, now);
        }
    }

    /**
     * 移除成员只更新技能组当前配置，不修改任何数字员工关系，也不影响已经安装的快照。
     *
     * @param qo 技能组及待移除技能
     */
    @Transactional(rollbackFor = Exception.class)
    public void removeMembers(SkillGroupMemberChangeQo qo) {
        List<Long> skillIds = normalizeRequiredIds(qo.getSkillIds());
        SsResource group = loadManagedGroupForUpdate(qo.getGroupId());
        List<SsResourceRelDetail> existing = skillGroupMapper.selectMemberRelationsIncludingInactive(
                group.getResourceId(), skillIds);
        Date now = new Date();
        Long userId = CurrentUserHolder.getCurrentUserId();
        for (SsResourceRelDetail relation : existing) {
            if (!Objects.equals(1, relation.getRelStatus())) {
                continue;
            }
            relation.setRelStatus(0);
            relation.setUpdateBy(userId);
            relation.setUpdateTime(now);
            if (!relationService.updateById(relation)
                    && isMemberActive(group.getResourceId(), relation.getRelResourceId())) {
                throw new BaseException("技能组成员已被并发修改，请刷新后重试");
            }
        }
    }

    /**
     * 删除技能组前检查安装快照来源；仍被数字员工安装时必须先卸载。删除仅清理组成员关系和组资源，
     * 不删除普通技能资源，也不会隐式修改数字员工关系。
     *
     * @param qo 技能组标识
     */
    @Transactional(rollbackFor = Exception.class)
    public void delete(SkillGroupIdQo qo) {
        delete(qo.getGroupId());
    }

    /**
     * 删除技能组前获取数据库行锁并检查安装快照来源；仍被数字员工安装时必须先卸载。
     * Task 5 安装/卸载必须获取同一个技能组行锁，才能与删除形成互斥。删除不传播成员变化。
     *
     * @param groupId 技能组标识
     */
    @Transactional(rollbackFor = Exception.class)
    public void delete(Long groupId) {
        requireAdminVipCreatePermission();
        SsResource group = loadManagedGroupForUpdate(groupId);
        List<SsResourceRelDetail> candidates =
                skillGroupMapper.selectSkillRelationsWithSourceInfoByTenant(group.getComAcctId());
        boolean installed = candidates.stream()
                .map(SsResourceRelDetail::getRelResourceInfo)
                .map(SkillRelationSource::parse)
                .anyMatch(source -> source.hasGroup(groupId));
        if (installed) {
            throw new BaseException("技能组仍被数字员工引用，请先卸载后再删除");
        }
        relationService.remove(new LambdaQueryWrapper<SsResourceRelDetail>()
                .eq(SsResourceRelDetail::getResourceId, groupId)
                .eq(SsResourceRelDetail::getRelTypeName, MEMBER_REL_TYPE));
        resourceService.removeById(groupId);
    }

    private void validateInstallRequest(SkillGroupInstallQo qo) {
        if (qo == null || qo.getGroupId() == null || qo.getDigitalEmployeeId() == null) {
            throw new BaseException("数字员工和技能组标识不能为空");
        }
    }

    private SsResource loadAccessibleGroupForSnapshot(Long groupId, Long tenantId) {
        SsResource group = skillGroupMapper.selectGroupForUpdate(groupId, tenantId);
        if (group == null) {
            throw new BaseException("技能组不存在");
        }
        if (!SKILL_GROUP.equals(group.getResourceBizType())) {
            throw new BaseException("资源类型不是技能组");
        }
        if (!Objects.equals(tenantId, group.getComAcctId())) {
            throw new BaseException("技能组不属于当前企业");
        }
        boolean accessible = authApplicationService.hasResourceManagePermission(group)
                || authApplicationService.hasResourceUsePermission(group);
        if (!accessible) {
            throw new BaseException("当前用户没有技能组访问权限");
        }
        return group;
    }

    private SsResource loadManagedDigitalEmployeeForSnapshot(
            Long digitalEmployeeId, Long tenantId, SsResource group) {
        SsResource digitalEmployee = skillGroupMapper.selectDigitalEmployeeForUpdate(digitalEmployeeId, tenantId);
        if (digitalEmployee == null) {
            throw new BaseException("数字员工不存在或不属于当前企业");
        }
        if (!ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(digitalEmployee.getResourceBizType())) {
            throw new BaseException("安装目标不是数字员工");
        }
        if (!Objects.equals(tenantId, digitalEmployee.getComAcctId())
                || !Objects.equals(group.getComAcctId(), digitalEmployee.getComAcctId())) {
            throw new BaseException("数字员工与技能组不属于同一企业");
        }
        if (!authApplicationService.hasResourceManagePermission(digitalEmployee)) {
            throw new BaseException("当前用户没有数字员工管理权限");
        }
        return digitalEmployee;
    }

    private void requireAdminVipCreatePermission() {
        LinkedHashSet<String> adminVipUserCodes = new LinkedHashSet<>();
        adminVipUserCodes.add(ADMIN_VIP_USER_CODE);
        try {
            collectAdminVipUserCodes(
                    systemConfigService.getDcSystemConfigValueByCode(USER_CODE_CONFIG), adminVipUserCodes);
        }
        catch (RuntimeException ignored) {
            // 配置不可用时与前端 isAdminVip 一致，保留默认 adminvip。
        }
        if (!adminVipUserCodes.contains(CurrentUserHolder.getCurrentUserCode())) {
            throw new BaseException("当前用户不是 AdminVip，没有企业技能组创建权限");
        }
    }

    private void collectAdminVipUserCodes(Object value, Collection<String> target) {
        if (value == null) {
            return;
        }
        if (value instanceof Collection<?>) {
            ((Collection<?>) value).forEach(item -> collectAdminVipUserCodes(item, target));
            return;
        }
        if (value instanceof Map<?, ?>) {
            ((Map<?, ?>) value).values().forEach(item -> collectAdminVipUserCodes(item, target));
            return;
        }
        String text = String.valueOf(value).trim();
        if (text.isEmpty()) {
            return;
        }
        if (looksLikeJson(text)) {
            try {
                collectAdminVipUserCodes(JSON.parse(text), target);
            }
            catch (RuntimeException ignored) {
                // 与前端 isAdminVip 保持一致：疑似 JSON 但解析失败时不使用该配置。
            }
            return;
        }
        for (String userCode : text.split(",")) {
            String normalized = userCode.trim();
            if (!normalized.isEmpty()) {
                target.add(normalized);
            }
        }
    }

    private boolean looksLikeJson(String value) {
        return value.startsWith("[") || value.startsWith("{")
                || (value.startsWith("\"") && value.endsWith("\""));
    }

    private SsResource loadManagedGroupForUpdate(Long groupId) {
        Long tenantId = requireCurrentTenant();
        SsResource group = skillGroupMapper.selectGroupForUpdate(groupId, tenantId);
        validateManagedGroup(group, tenantId);
        return group;
    }

    private SsResource loadManagedGroup(Long groupId, Long tenantId) {
        SsResource group = resourceService.findById(groupId);
        validateManagedGroup(group, tenantId);
        return group;
    }

    private void validateManagedGroup(SsResource group, Long tenantId) {
        if (group == null) {
            throw new BaseException("技能组不存在");
        }
        if (!SKILL_GROUP.equals(group.getResourceBizType())) {
            throw new BaseException("资源类型不是技能组");
        }
        if (group.getComAcctId() == null || !group.getComAcctId().equals(tenantId)) {
            throw new BaseException("技能组不属于当前企业");
        }
        if (!authApplicationService.hasResourceManagePermission(group)) {
            throw new BaseException("当前用户没有技能组管理权限");
        }
    }

    private Long requireCurrentTenant() {
        Long tenantId = CurrentUserHolder.getEnterpriseId();
        if (tenantId == null) {
            throw new BaseException("当前用户企业信息缺失");
        }
        return tenantId;
    }

    private List<Long> normalizeRequiredIds(List<Long> ids) {
        if (ids == null || ids.isEmpty() || ids.stream().anyMatch(Objects::isNull)) {
            throw new BaseException("组内技能列表不能为空");
        }
        return new ArrayList<>(new LinkedHashSet<>(ids));
    }

    private void validateMemberSkills(SsResource group, List<Long> skillIds) {
        if (skillIds.contains(group.getResourceId())) {
            throw new BaseException("技能组不能将自身添加为成员");
        }
        List<SsResource> resources = resourceService.findByIdList(skillIds);
        Map<Long, SsResource> byId = new LinkedHashMap<>();
        for (SsResource resource : resources) {
            byId.put(resource.getResourceId(), resource);
        }
        Map<Long, SsResExtSkill> extById = new LinkedHashMap<>();
        for (SsResExtSkill extSkill : extSkillService.findByIds(skillIds)) {
            extById.put(extSkill.getResourceId(), extSkill);
        }
        for (Long skillId : skillIds) {
            SsResource skill = byId.get(skillId);
            if (skill == null) {
                throw new BaseException("组内技能不存在：" + skillId);
            }
            if (!SKILL.equals(skill.getResourceBizType())) {
                throw new BaseException("成员资源不是普通技能：" + skillId);
            }
            if (!Objects.equals(group.getComAcctId(), skill.getComAcctId())) {
                throw new BaseException("组内技能不属于当前企业：" + skillId);
            }
            if (!"enterprise".equals(skill.getOwnerType())) {
                throw new BaseException("技能组成员只能选择企业技能：" + skillId);
            }
            if (!Objects.equals(ResourceStatus.LIST.getNum(), skill.getResourceStatus())) {
                throw new BaseException("组内技能未上架：" + skillId);
            }
            SsResExtSkill extSkill = extById.get(skillId);
            boolean innerSkill = extSkill != null
                    && SsResExtSkillService.INNER_SKILL_TYPE.equalsIgnoreCase(extSkill.getSkillType());
            boolean creatorOwned = group.getCreateBy() != null
                    && Objects.equals(group.getCreateBy(), skill.getCreateBy());
            if (!innerSkill && !creatorOwned) {
                throw new BaseException("技能组成员只能选择系统内置技能或原创建人创建的技能：" + skillId);
            }
        }
    }

    private void insertMemberRelationIfAbsent(SsResource group, Long skillId, Long userId, Date now) {
        SsResourceRelDetail relation = new SsResourceRelDetail();
        relation.setResourceRelDetailId(sequenceService.nextVal());
        relation.setResourceId(group.getResourceId());
        relation.setRelResourceId(skillId);
        relation.setRelTypeName(MEMBER_REL_TYPE);
        relation.setRelStatus(1);
        relation.setCreateBy(userId);
        relation.setCreateTime(now);
        relation.setUpdateBy(userId);
        relation.setUpdateTime(now);
        relation.setComAcctId(group.getComAcctId());
        if (skillGroupMapper.insertActiveMemberIfAbsent(relation) == 0
                && !isMemberActive(group.getResourceId(), skillId)) {
            throw new BaseException("技能组成员已被并发修改，请刷新后重试");
        }
    }

    private boolean isMemberActive(Long groupId, Long skillId) {
        return skillGroupMapper.selectMemberRelationsIncludingInactive(groupId, List.of(skillId)).stream()
                .anyMatch(relation -> Objects.equals(1, relation.getRelStatus()));
    }

    private SkillGroupVo toVo(SsResource resource) {
        SkillGroupVo vo = new SkillGroupVo();
        vo.setResourceId(resource.getResourceId());
        vo.setResourceName(resource.getResourceName());
        vo.setResourceDesc(resource.getResourceDesc());
        vo.setAvatar(resource.getAvatar());
        vo.setCatalogId(resource.getCatalogId());
        vo.setOwnerType(resource.getOwnerType());
        vo.setResourceStatus(resource.getResourceStatus());
        vo.setCreateBy(resource.getCreateBy());
        vo.setCreateTime(resource.getCreateTime());
        vo.setUpdateTime(resource.getUpdateTime());
        return vo;
    }
}
