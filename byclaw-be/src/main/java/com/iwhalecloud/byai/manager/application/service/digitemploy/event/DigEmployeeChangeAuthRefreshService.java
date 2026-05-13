package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import java.util.HashSet;
import java.util.List;
import java.util.Set;

import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.scheduling.annotation.Async;
import org.springframework.stereotype.Service;

import com.iwhalecloud.byai.manager.application.service.auth.AuthRedisSyncService;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;

/**
 * 可选：按资源维度展开红名单授权对象并批量触发用户权限 Redis 重建（较重，默认关闭）。
 */
@Service
public class DigEmployeeChangeAuthRefreshService {

    private static final Logger logger = LoggerFactory.getLogger(DigEmployeeChangeAuthRefreshService.class);

    private static final String HINT = "dig_employee_metadata_change";

    @Autowired
    private DigEmployeeChangeNotifyProperties properties;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private UserService userService;

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private AuthRedisSyncService authRedisSyncService;

    @Async
    public void scheduleRefreshGranteesAsync(Long resourceId) {
        if (!properties.isAuthRefreshEnabled() || resourceId == null) {
            return;
        }
        try {
            Set<Long> userIds = resolveGranteeUserIds(resourceId);
            if (userIds.isEmpty()) {
                return;
            }
            authRedisSyncService.asyncSyncAuthChangedUsers(userIds, HINT);
            logger.info("Scheduled user auth redis refresh for dig_employee {}, userCount={}", resourceId,
                userIds.size());
        }
        catch (Exception e) {
            logger.warn("dig_employee auth refresh failed, resourceId={}, err={}", resourceId, e.getMessage());
        }
    }

    private Set<Long> resolveGranteeUserIds(Long resourceId) {
        List<PrivilegeGrant> grants = privilegeGrantService
            .listActiveRedGrantsForGrantObject(resourceId, ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        if (CollectionUtils.isEmpty(grants)) {
            return Set.of();
        }
        Set<Long> userIds = new HashSet<>();
        Set<Long> orgIds = new HashSet<>();
        Set<Long> postIds = new HashSet<>();
        Set<Long> stationIds = new HashSet<>();
        for (PrivilegeGrant g : grants) {
            if (g == null || g.getGrantToObjId() == null) {
                continue;
            }
            String t = g.getGrantToObjType();
            if (GrantToObjType.USER.equalsIgnoreCase(t)) {
                userIds.add(g.getGrantToObjId());
            }
            else if (GrantToObjType.ORG.equalsIgnoreCase(t)) {
                orgIds.add(g.getGrantToObjId());
            }
            else if (GrantToObjType.POST.equalsIgnoreCase(t)) {
                postIds.add(g.getGrantToObjId());
            }
            else if (GrantToObjType.STATION.equalsIgnoreCase(t)) {
                stationIds.add(g.getGrantToObjId());
            }
        }
        for (Long orgId : orgIds) {
            try {
                List<Long> ids = userService.findUserIdsByOrgId(orgId);
                if (CollectionUtils.isNotEmpty(ids)) {
                    userIds.addAll(ids);
                }
            }
            catch (Exception e) {
                logger.warn("findUserIdsByOrgId failed orgId={}", orgId, e);
            }
        }
        for (Long postId : postIds) {
            try {
                List<Long> ids = usersMapper.findUserIdsByPostId(postId);
                if (CollectionUtils.isNotEmpty(ids)) {
                    userIds.addAll(ids);
                }
            }
            catch (Exception e) {
                logger.warn("findUserIdsByPostId failed postId={}", postId, e);
            }
        }
        for (Long stationId : stationIds) {
            try {
                List<Long> ids = usersMapper.findUserIdsByStationId(stationId);
                if (CollectionUtils.isNotEmpty(ids)) {
                    userIds.addAll(ids);
                }
            }
            catch (Exception e) {
                logger.warn("findUserIdsByStationId failed stationId={}", stationId, e);
            }
        }
        return userIds;
    }
}
