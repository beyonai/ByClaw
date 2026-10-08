package com.iwhalecloud.byai.manager.application.service.auth;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGroupApplicationService;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.HashSet;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/** 冷启动时补齐存量员工组向组员及其关联资源的授权。 */
@Service
public class DigitalEmployeeGroupAuthorizationBackfillService {

    private static final Logger logger = LoggerFactory.getLogger(DigitalEmployeeGroupAuthorizationBackfillService.class);
    private static final int BATCH_SIZE = 200;

    @Autowired
    private SsResExtDigEmployeeMapper employeeMapper;

    @Autowired
    private SsResourceMapper resourceMapper;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private DigitalEmployeeGroupAuthorizationService groupAuthorizationService;

    @Autowired
    private AuthApplicationService authApplicationService;

    public void backfill() {
        Long lastResourceId = null;
        int repaired = 0;
        while (true) {
            LambdaQueryWrapper<SsResExtDigEmployee> query = new LambdaQueryWrapper<SsResExtDigEmployee>()
                .eq(SsResExtDigEmployee::getAgentType, DigitalEmployeeGroupApplicationService.GROUP_AGENT_TYPE)
                .orderByAsc(SsResExtDigEmployee::getResourceId)
                .last("LIMIT " + BATCH_SIZE);
            if (lastResourceId != null) {
                query.gt(SsResExtDigEmployee::getResourceId, lastResourceId);
            }
            List<SsResExtDigEmployee> groups = employeeMapper.selectList(query);
            if (groups == null || groups.isEmpty()) {
                break;
            }
            for (SsResExtDigEmployee ext : groups) {
                lastResourceId = ext.getResourceId();
                try {
                    repaired += backfillGroup(ext.getResourceId());
                } catch (Exception e) {
                    logger.error("补齐数字员工组 {} 关联资源授权失败", ext.getResourceId(), e);
                }
            }
            if (groups.size() < BATCH_SIZE) {
                break;
            }
        }
        logger.info("数字员工组存量关联授权补齐完成，更新 {} 个资源授权", repaired);
    }

    int backfillGroup(Long groupId) {
        SsResource group = resourceMapper.selectById(groupId);
        if (group == null || !ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(group.getResourceBizType())
            || !ResourceStatus.ON_SHELF.getNum().equals(group.getResourceStatus())) {
            return 0;
        }
        int repaired = 0;
        for (String grantType : List.of(GrantType.FORCE_USE, GrantType.ALLOW_MANAGE)) {
            List<PrivilegeGrant> red = grants(grantType, group.getResourceBizType(), groupId, Color.RED);
            List<PrivilegeGrant> black = grants(grantType, group.getResourceBizType(), groupId, Color.BLACK);
            if (red.isEmpty() && black.isEmpty()) {
                continue;
            }
            AuthRedBlackDTO groupAuth = new AuthRedBlackDTO();
            groupAuth.setGrantType(grantType);
            groupAuth.setGrantObjType(group.getResourceBizType());
            groupAuth.setGrantObjId(groupId);
            groupAuth.setRedList(targets(red));
            groupAuth.setBlackList(targets(black));
            for (AuthRedBlackDTO relatedAuth : groupAuthorizationService.buildMemberAuthorizations(group, groupAuth)) {
                if (sameTargets(relatedAuth.getRedList(), grants(grantType, relatedAuth.getGrantObjType(),
                        relatedAuth.getGrantObjId(), Color.RED))
                    && sameTargets(relatedAuth.getBlackList(), grants(grantType, relatedAuth.getGrantObjType(),
                        relatedAuth.getGrantObjId(), Color.BLACK))) {
                    continue;
                }
                authApplicationService.handleAuth(relatedAuth);
                repaired++;
            }
        }
        return repaired;
    }

    private List<PrivilegeGrant> grants(String grantType, String resourceType, Long resourceId, String color) {
        return privilegeGrantService.findPrivilegeGrant(grantType, resourceType, resourceId, color);
    }

    private static List<AuthDTO> targets(List<PrivilegeGrant> grants) {
        return grants.stream().map(grant -> {
            AuthDTO target = new AuthDTO();
            target.setGrantToObjType(grant.getGrantToObjType());
            target.setGrantToObjId(grant.getGrantToObjId());
            return target;
        }).collect(Collectors.toList());
    }

    private static boolean sameTargets(List<AuthDTO> requested, List<PrivilegeGrant> existing) {
        Set<String> requestedKeys = requested == null ? Set.of() : requested.stream()
            .map(target -> target.getGrantToObjType() + ":" + target.getGrantToObjId())
            .collect(Collectors.toSet());
        Set<String> existingKeys = new HashSet<>();
        for (PrivilegeGrant grant : existing) {
            existingKeys.add(grant.getGrantToObjType() + ":" + grant.getGrantToObjId());
        }
        return requestedKeys.equals(existingKeys);
    }
}
