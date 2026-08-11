package com.iwhalecloud.byai.manager.application.service.skillgroup;

import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeRuntimeRefreshService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.model.SkillRelationSource;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.skillgroup.event.SkillUsePermissionChangedEvent;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import java.util.Set;
import java.util.TreeSet;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.event.TransactionPhase;
import org.springframework.transaction.event.TransactionalEventListener;

@Service
public class SkillInstallSourceReconciliationService {

    private static final String SKILL = ResourceBizTypeEnum.SKILL.name();

    private final SsResourceService resourceService;
    private final SsResourceRelDetailService relationService;
    private final SkillGroupMapper skillGroupMapper;
    private final AuthApplicationService authApplicationService;
    private final DigitalEmployeeRuntimeRefreshService runtimeRefreshService;

    public SkillInstallSourceReconciliationService(
            SsResourceService resourceService,
            SsResourceRelDetailService relationService,
            SkillGroupMapper skillGroupMapper,
            AuthApplicationService authApplicationService,
            DigitalEmployeeRuntimeRefreshService runtimeRefreshService) {
        this.resourceService = resourceService;
        this.relationService = relationService;
        this.skillGroupMapper = skillGroupMapper;
        this.authApplicationService = authApplicationService;
        this.runtimeRefreshService = runtimeRefreshService;
    }

    @TransactionalEventListener(phase = TransactionPhase.BEFORE_COMMIT)
    public void reconcile(SkillUsePermissionChangedEvent event) {
        SsResource skill = requireActiveTenantSkill(event);
        Set<Long> revokedUserIds = new TreeSet<>();
        for (Long userId : event.affectedUserIds()) {
            if (!authApplicationService.hasResourceUsePermission(skill, userId)) {
                revokedUserIds.add(userId);
            }
        }
        if (revokedUserIds.isEmpty()) {
            return;
        }

        List<SsResourceRelDetail> candidates = skillGroupMapper.selectActiveEmployeeSkillRelationsBySkill(
            event.skillResourceId(), event.comAcctId());
        Set<Long> employeeIds = new TreeSet<>();
        if (candidates != null) {
            candidates.stream().map(SsResourceRelDetail::getResourceId).filter(Objects::nonNull)
                .forEach(employeeIds::add);
        }

        List<Long> changedEmployeeIds = new ArrayList<>();
        for (Long employeeId : employeeIds) {
            SsResource employee = skillGroupMapper.selectDigitalEmployeeForUpdate(employeeId, event.comAcctId());
            if (employee == null) {
                continue;
            }
            List<SsResourceRelDetail> currentRelations = skillGroupMapper.selectDigitalEmployeeSkillRelations(
                employeeId, List.of(event.skillResourceId()));
            boolean employeeChanged = reconcileRelations(currentRelations, revokedUserIds, event.changedBy());
            if (employeeChanged) {
                changedEmployeeIds.add(employeeId);
            }
        }
        if (!changedEmployeeIds.isEmpty()) {
            runtimeRefreshService.scheduleSkillRuntimeRefreshAfterCommit(changedEmployeeIds);
        }
    }

    private SsResource requireActiveTenantSkill(SkillUsePermissionChangedEvent event) {
        SsResource skill = resourceService.findById(event.skillResourceId());
        if (skill == null || !Objects.equals(event.comAcctId(), skill.getComAcctId())
                || !StringUtils.equals(SKILL, skill.getResourceBizType())
                || !Objects.equals(ResourceStatus.LIST.getNum(), skill.getResourceStatus())) {
            throw new IllegalStateException("Active tenant skill not found: " + event.skillResourceId());
        }
        return skill;
    }

    private boolean reconcileRelations(List<SsResourceRelDetail> relations, Set<Long> revokedUserIds, Long changedBy) {
        boolean changed = false;
        if (relations == null) {
            return false;
        }
        for (SsResourceRelDetail relation : relations) {
            SkillRelationSource source = SkillRelationSource.parse(relation.getRelResourceInfo());
            if (source.isMalformed()) {
                continue;
            }
            String originalJson = source.toJson();
            for (Long userId : revokedUserIds) {
                source.removeInstallerFromAllGroups(userId);
            }
            String remainingJson = source.toJson();
            if (StringUtils.equals(originalJson, remainingJson)) {
                continue;
            }
            if (source.hasAnySource()) {
                relation.setRelResourceInfo(remainingJson);
                relation.setUpdateBy(changedBy);
                relation.setUpdateTime(new Date());
                if (!relationService.updateById(relation)) {
                    throw new IllegalStateException("Skill relation update failed: "
                        + relation.getResourceRelDetailId());
                }
            } else if (!relationService.removeById(relation.getResourceRelDetailId())) {
                throw new IllegalStateException("Skill relation delete failed: "
                    + relation.getResourceRelDetailId());
            }
            changed = true;
        }
        return changed;
    }
}
