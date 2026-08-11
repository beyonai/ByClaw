package com.iwhalecloud.byai.manager.application.service.skillgroup;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.skillgroup.model.SkillGroupMemberStatus;
import com.iwhalecloud.byai.manager.mapper.resource.SkillGroupMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.vo.skillgroup.SkillGroupMemberVo;
import java.util.Collections;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;

@Service
public class SkillGroupMemberStatusService {

    public static final String APPLY_UNAVAILABLE_REASON = "USE_PERMISSION_UNAVAILABLE";

    private final AuthApplicationService authApplicationService;
    private final SkillGroupMapper skillGroupMapper;

    public SkillGroupMemberStatusService(
            AuthApplicationService authApplicationService, SkillGroupMapper skillGroupMapper) {
        this.authApplicationService = authApplicationService;
        this.skillGroupMapper = skillGroupMapper;
    }

    public List<SkillGroupMemberVo> evaluate(List<SkillGroupMemberVo> members, Long digitalEmployeeId) {
        if (members == null) {
            return Collections.emptyList();
        }
        if (members.isEmpty()) {
            return members;
        }

        List<Long> memberIds = members.stream()
                .filter(member -> member != null && member.getResourceId() != null)
                .map(SkillGroupMemberVo::getResourceId)
                .distinct()
                .collect(Collectors.toList());
        Long tenantId = null;
        if (digitalEmployeeId != null && !memberIds.isEmpty()) {
            tenantId = requireCurrentTenant();
        }
        Map<Long, ResourceOperationPermissionsVo> permissionsById = memberIds.isEmpty()
                ? Collections.emptyMap()
                : authApplicationService.queryResourceOperationPermissionsBatch(memberIds);
        if (permissionsById == null) {
            permissionsById = Collections.emptyMap();
        }

        Set<Long> installedIds = Collections.emptySet();
        if (digitalEmployeeId != null && !memberIds.isEmpty()) {
            List<Long> selectedIds = skillGroupMapper.selectInstalledSkillIds(digitalEmployeeId, tenantId, memberIds);
            if (selectedIds != null && !selectedIds.isEmpty()) {
                installedIds = new LinkedHashSet<>(selectedIds);
            }
        }

        for (SkillGroupMemberVo member : members) {
            if (member == null) {
                continue;
            }
            Long memberId = member.getResourceId();
            ResourceOperationPermissionsVo permissions = memberId == null ? null : permissionsById.get(memberId);
            boolean installed = memberId != null && installedIds.contains(memberId);
            boolean hasUsePermission = permissions != null
                    && Boolean.TRUE.equals(permissions.getHasUsePermission());

            member.setInstalled(installed);
            member.setHasUsePermission(hasUsePermission);
            member.setStatusReason(null);
            if (hasUsePermission) {
                member.setMemberStatus(installed
                        ? SkillGroupMemberStatus.INSTALLED
                        : SkillGroupMemberStatus.INSTALLABLE);
            } else if (permissions != null && Boolean.TRUE.equals(permissions.getUseApplyPending())) {
                member.setMemberStatus(SkillGroupMemberStatus.APPLY_PENDING);
            } else if (permissions != null && Boolean.TRUE.equals(permissions.getCanApplyUse())) {
                member.setMemberStatus(SkillGroupMemberStatus.APPLY_REQUIRED);
            } else {
                member.setMemberStatus(SkillGroupMemberStatus.APPLY_UNAVAILABLE);
                member.setStatusReason(APPLY_UNAVAILABLE_REASON);
            }
        }
        return members;
    }

    private Long requireCurrentTenant() {
        Long tenantId = CurrentUserHolder.getEnterpriseId();
        if (tenantId == null) {
            throw new BaseException("当前用户企业信息缺失");
        }
        return tenantId;
    }
}
