package com.iwhalecloud.byai.state.domain.resource.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import com.iwhalecloud.byai.manager.qo.auth.AuthContextQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo;
import com.iwhalecloud.byai.manager.dto.auth.AuthResourceType;
import com.iwhalecloud.byai.manager.mapper.auth.ResourceAuthContextMapper;
import com.iwhalecloud.byai.common.constants.users.UserType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 统一对外的资源权限上下文Service。
 * <p>
 * 通过策略工厂按类型获取资源ID列表。 支持普通权限和共享权限两种方式。 用法示例： resourceAuthContextService.getResourceIds(AgentMetaEnum.DATASET);
 */
@Service
public class ResourceAuthContextService {

    @Autowired
    private ResourceAuthContextMapper resourceAuthContextMapper;

    /**
     * 获取当前用户授权资源标识上下文对象
     *
     * @return AuthResourceIdBo
     */
    public AuthContextBo getAuthContextBo() {

        // 设置当前用户信息
        AuthContextQo authContextQo = new AuthContextQo();
        this.setCurrentUserAuthQo(authContextQo);
        List<AuthResourceType> authResourceTypes = resourceAuthContextMapper.getAuthResourceType(authContextQo);

        Set<Long> allAuthResourceIds = new HashSet<>();
        Map<String, List<Long>> allAuthResourceTypeMap = new HashMap<>();
        for (AuthResourceType authResourceType : authResourceTypes) {

            Long resourceId = authResourceType.getResourceId();
            String resourceBizType = authResourceType.getResourceBizType();

            // 添加到全局授权
            allAuthResourceIds.add(resourceId);

            // 按资源类型归类：key 为 grantObjType，value 为该类型下的资源 ID 列表
            allAuthResourceTypeMap.computeIfAbsent(resourceBizType, k -> new ArrayList<>()).add(resourceId);
        }

        return new AuthContextBo(allAuthResourceIds, allAuthResourceTypeMap);
    }

    /**
     * 设置当前用户授权查询条件。 将当前会话用户的ID、组织ID列表、岗位ID等信息填充到查询对象中。
     *
     * @param authQo 授权查询对象
     */
    public void setCurrentUserAuthQo(AuthQo authQo) {

        authQo.setUserId(CurrentUserHolder.getCurrentUserId());
        // 用户组织路径相关
        authQo.setUserOrgIds(CurrentUserHolder.getUserOrgIds());
        authQo.setUserStationId(CurrentUserHolder.getUserStationId());
        authQo.setUserPositionIds(CurrentUserHolder.getUserPositionIds());
        authQo.setPlatformManager(CurrentUserHolder.isPlatformManager());
        authQo.setManagerOrgPathCodes(CurrentUserHolder.getUsersOrganizations().stream()
            .filter(item -> UserType.ORG_MAN.equals(item.getUserType()))
            .map(UsersOrganization::getPathCode)
            .filter(StringUtils::isNotBlank)
            .distinct()
            .collect(Collectors.toList()));
    }

    /**
     * 获取指定类型的资源ID列表（普通权限）。
     *
     * @param resourceBizType 资源类型
     * @return 资源ID列表
     */
    public List<Long> getAuthResourceIds(String resourceBizType) {

        AuthContextQo authContextQo = new AuthContextQo();
        authContextQo.setResourceBizType(resourceBizType);

        // 设置用户上下文信息
        this.setCurrentUserAuthQo(authContextQo);
        List<AuthResourceType> authResourceTypes = resourceAuthContextMapper.getAuthResourceType(authContextQo);

        List<Long> authResourceIds = new ArrayList<>(authResourceTypes.size());
        for (AuthResourceType authResourceType : authResourceTypes) {
            authResourceIds.add(authResourceType.getResourceId());
        }
        return authResourceIds;
    }

}
