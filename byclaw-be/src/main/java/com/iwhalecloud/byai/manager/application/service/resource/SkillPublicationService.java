package com.iwhalecloud.byai.manager.application.service.resource;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGovernanceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 上架审核只认可 adminvip / 平台管理角色，不继承资源管理授权。 */
@Service
@RequiredArgsConstructor
public class SkillPublicationService {
    private final PrivilegeGrantMapper mapper;
    private final SsResourceService resources;
    private final SequenceService sequence;
    private final SsResExtSkillService skills;
    private final DigitalEmployeeGovernanceService governance;

    public boolean canReview() {
        return CurrentUserHolder.isAdminVip() || CurrentUserHolder.isPlatformManager();
    }

    /** 独立发布副本的创建人可能是代发布人，审核归属必须读取冻结的来源创建人。 */
    public boolean canReview(SsResource target) {
        if (!canReview() || target == null || !"SKILL".equals(target.getResourceBizType())
            || !"enterprise".equals(target.getOwnerType()) || CurrentUserHolder.getEnterpriseId() == null
            || !Objects.equals(target.getComAcctId(), CurrentUserHolder.getEnterpriseId())) return false;
        if (CurrentUserHolder.isAdminVip()) return true;
        var ext = skills.findById(target.getResourceId());
        Long creatorId = target.getCreateBy();
        if (ext != null && org.apache.commons.lang3.StringUtils.isNotBlank(ext.getTargetContent())) {
            try {
                var provenance = com.alibaba.fastjson.JSON.parseObject(ext.getTargetContent());
                if (provenance.containsKey("sourceCreatorId")) creatorId = provenance.getLong("sourceCreatorId");
            } catch (RuntimeException invalidProvenance) { return false; }
        }
        return creatorId != null && !governance.isAdminVipCreator(creatorId);
    }

    /** 调用方已经锁定个人源技能；创建快照与申请处于同一个事务。 */
    public void submit(SsResource source, SsResource target) {
        PrivilegeGrant request = new PrivilegeGrant();
        request.setPrivilegeGrantId(sequence.nextVal());
        request.setGrantType(GrantType.SKILL_PUBLICATION);
        request.setGrantObjType("SKILL");
        request.setGrantObjId(target.getResourceId());
        request.setGrantToObjId(CurrentUserHolder.getCurrentUserId());
        request.setGrantToObjType("USER");
        request.setGrantToType("RED");
        request.setOperType("READ");
        boolean automatic = canReview() && (CurrentUserHolder.isAdminVip()
            || source.getCreateBy() != null && !governance.isAdminVipCreator(source.getCreateBy()));
        request.setStatusCd(automatic ? "X" : "P");
        request.setCreateStaff(CurrentUserHolder.getCurrentUserId());
        request.setCreateDate(new Date());
        if (automatic) {
            request.setUpdateStaff(CurrentUserHolder.getCurrentUserId());
            request.setUpdateDate(new Date());
        }
        mapper.insert(request);
        target.setResourceStatus(automatic ? ResourceStatus.ON_SHELF.getNum() : ResourceStatus.AUDIT.getNum());
        resources.updateResourceEntity(target);
    }

    @Transactional(rollbackFor = Exception.class)
    public void review(Long resourceId, Long applicantId, boolean approve) {
        if (!canReview()) throw new IllegalArgumentException(I18nUtil.get("skill.publication.review.denied"));
        // 资源锁串行化同一快照的审核，企业校验避免跨企业审核。
        SsResource target = resources.findByIdForUpdate(resourceId);
        if (target == null || !"SKILL".equals(target.getResourceBizType())
            || !"enterprise".equals(target.getOwnerType())
            || CurrentUserHolder.getEnterpriseId() == null
            || !Objects.equals(target.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            || !Objects.equals(target.getResourceStatus(), ResourceStatus.AUDIT.getNum())) {
            throw new IllegalArgumentException(I18nUtil.get("skill.publication.review.processed"));
        }
        if (!canReview(target)) throw new IllegalArgumentException(I18nUtil.get("skill.publication.review.adminvip.only"));
        PrivilegeGrant request = mapper.selectOne(new LambdaQueryWrapper<PrivilegeGrant>()
            .eq(PrivilegeGrant::getGrantObjId, resourceId)
            .eq(PrivilegeGrant::getGrantObjType, "SKILL")
            .eq(PrivilegeGrant::getGrantType, GrantType.SKILL_PUBLICATION)
            .eq(PrivilegeGrant::getGrantToObjId, applicantId)
            .eq(PrivilegeGrant::getGrantToObjType, "USER")
            .eq(PrivilegeGrant::getGrantToType, "RED")
            .eq(PrivilegeGrant::getOperType, "READ")
            .eq(PrivilegeGrant::getStatusCd, "P").last("FOR UPDATE"));
        if (request == null) {
            throw new IllegalArgumentException(I18nUtil.get("skill.publication.review.processed"));
        }
        target.setResourceStatus(approve ? ResourceStatus.ON_SHELF.getNum() : ResourceStatus.AUDIT_REJECT.getNum());
        resources.updateResourceEntity(target);
        // 使用现有申请终态，不写入有效授权 A，也不生成 FORCE_USE 授权。
        request.setStatusCd(approve ? "X" : "R");
        request.setUpdateStaff(CurrentUserHolder.getCurrentUserId());
        request.setUpdateDate(new Date());
        mapper.updateById(request);
    }
}
