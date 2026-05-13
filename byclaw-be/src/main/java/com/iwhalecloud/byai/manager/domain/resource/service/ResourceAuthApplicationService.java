package com.iwhalecloud.byai.manager.domain.resource.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.constants.auth.GrantObjType;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.request.DigEmployeeRelResourceQo;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthQo;
import com.iwhalecloud.byai.manager.qo.auth.DigitalEmployeeAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.PrivilegeGrantQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceAuthQo;
import com.iwhalecloud.byai.manager.qo.index.OrgFilterQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeAuthVo;
import com.iwhalecloud.byai.manager.vo.auth.GrantSourceVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.ArrayList;
import java.util.Collections;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;

@Service
public class ResourceAuthApplicationService {

    private static final String BELONG_COMPANY = "COMPANY";

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private ResourceAuthContextService resourceAuthContextService;

    @Autowired
    private IndexService indexService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private UserService userService;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private AuthApplicationService authApplicationService;

    /**
     * 组织-资源授权明细列表查询
     *
     * @param resourceUseAuthQo 资源授权查询对象
     * @return PageInfo<ResourceAuthVo>
     */
    public PageInfo<ResourceAuthVo> listResourceAuth(ResourceUseAuthQo resourceUseAuthQo) {

        // 添加用户权限上下文信息
        resourceAuthContextService.setCurrentUserAuthQo(resourceUseAuthQo);
        fillPublishOrgIds(resourceUseAuthQo);
        fillCatalogIds(resourceUseAuthQo);

        PageInfo<ResourceAuthVo> pageInfo = privilegeGrantService.listResourceAuth(resourceUseAuthQo);
        return pageInfo;

    }

    private void fillPublishOrgIds(ResourceUseAuthQo resourceUseAuthQo) {
        if (resourceUseAuthQo == null || !StringUtils.equals(resourceUseAuthQo.getOwnerType(), "enterprise")) {
            return;
        }
        if (StringUtils.equals(resourceUseAuthQo.getBelong(), BELONG_COMPANY)) {
            resourceUseAuthQo.setPublishOrgIds(indexService.findTopOrgId());
            return;
        }
        if (CollectionUtils.isEmpty(resourceUseAuthQo.getOrgFilters())) {
            return;
        }
        List<Long> publishOrgIds = new ArrayList<>();
        for (OrgFilterQo orgFilter : resourceUseAuthQo.getOrgFilters()) {
            if (orgFilter != null && orgFilter.getObjectId() != null) {
                publishOrgIds.add(orgFilter.getObjectId());
            }
        }
        resourceUseAuthQo.setPublishOrgIds(publishOrgIds);
    }

    /**
     * 分页查询数字员工关联的资源列表。 与 listResourceAuth 返回结构保持一致，但这里不走授权逻辑， 而是直接按数字员工与资源的关联关系查询。
     */
    public PageInfo<ResourceAuthVo> listDigitalEmployeeRelResourceAuth(DigEmployeeRelResourceQo qo) {
        if (qo == null || qo.getResourceId() == null) {
            PageInfo<ResourceAuthVo> pageInfo = new PageInfo<>();
            pageInfo.setList(Collections.emptyList());
            return pageInfo;
        }
        String keyword = StringUtils.trimToNull(qo.getKeyword());
        qo.setKeyword(keyword);
        qo.setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(qo.getCatalogId()));
        Page<ResourceAuthVo> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        ssResourceMapper.queryDigEmployeeRelResourceAuthList(qo);
        PageInfo<ResourceAuthVo> pageInfo = PageHelperUtil.toPageInfo(page);
        return pageInfo;
    }

    private void fillCatalogIds(ResourceUseAuthQo resourceUseAuthQo) {
        if (resourceUseAuthQo == null || resourceUseAuthQo.getCatalogId() == null) {
            return;
        }
        resourceUseAuthQo
            .setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(resourceUseAuthQo.getCatalogId()));
    }

    public PageInfo<ResourceAuthVo> listResource(ResourceAuthQo resourceAuthQo) {

        // 添加用户权限上下文信息
        resourceAuthContextService.setCurrentUserAuthQo(resourceAuthQo);

        return privilegeGrantService.listResource(resourceAuthQo);
    }

    /**
     * 查询数字员工
     *
     * @param digitalEmployeeAuthQo 资源信息
     * @return DigitalEmployeeAuthVo
     */
    public PageInfo<DigitalEmployeeAuthVo> listDigitalEmployeeAuthByUser(DigitalEmployeeAuthQo digitalEmployeeAuthQo) {

        AuthQo authQo = new AuthQo();
        authQo.setPageNum(digitalEmployeeAuthQo.getPageNum());
        authQo.setPageSize(digitalEmployeeAuthQo.getPageSize());
        authQo.setKeyword(digitalEmployeeAuthQo.getKeyword());

        Long userId = digitalEmployeeAuthQo.getGrantToObjId();

        Users users = userService.findById(userId);

        List<UsersOrganization> orgList = organizationService.findUsersOrganizationByUserId(users.getUserId());

        Set<Long> userOrgIds = new HashSet<>();
        Set<Long> userPositionIds = new HashSet<>();
        for (UsersOrganization usersOrganization : orgList) {
            userOrgIds.add(usersOrganization.getOrgId());
            userPositionIds.add(usersOrganization.getPositionId());
        }

        authQo.setUserId(users.getUserId());
        authQo.setUserOrgIds(userOrgIds);
        authQo.setUserStationId(users.getStationId());
        authQo.setUserPositionIds(userPositionIds);

        PageInfo<DigitalEmployeeAuthVo> pageInfo = privilegeGrantService.listDigitalEmployeeAuthByUser(authQo);

        List<DigitalEmployeeAuthVo> digitalEmployeeAuthVos = pageInfo.getList();

        for (DigitalEmployeeAuthVo digitalEmployeeAuthVo : digitalEmployeeAuthVos) {
            Long resourceId = digitalEmployeeAuthVo.getResourceId();
            long blackCount = digitalEmployeeAuthVo.getBlackCount();
            long forceUseCount = digitalEmployeeAuthVo.getForceUseCount();
            long availableUseCount = digitalEmployeeAuthVo.getAvailableUseCount();
            long allowManageCount = digitalEmployeeAuthVo.getAllowManageCount();

            // 如果有黑名单，直接没权限
            if (blackCount > 0) {
                digitalEmployeeAuthVo.setHasPermission(false);
            }
            else if (GrantType.ALLOW_MANAGE.equals(digitalEmployeeAuthQo.getGrantType()) && allowManageCount > 0) {
                digitalEmployeeAuthVo.setHasPermission(true);
            }
            else if (GrantType.FORCE_USE.equals(digitalEmployeeAuthQo.getGrantType())
                && (forceUseCount > 0 || availableUseCount > 0 || userId.equals(digitalEmployeeAuthVo.getCreateBy()))) {
                digitalEmployeeAuthVo.setHasPermission(true);
            }

            String grantType = digitalEmployeeAuthQo.getGrantType();
            digitalEmployeeAuthVo.setGrantSourceVos(this.buildGrantSourceVo(resourceId, grantType));
        }

        return pageInfo;

    }

    /**
     * 查询授权对象，构建授权Map
     *
     * @return Map
     */
    private List<GrantSourceVo> buildGrantSourceVo(Long resourceId, String grantType) {

        PrivilegeGrantQo privilegeGrantQo = new PrivilegeGrantQo();

        if (GrantType.FORCE_USE.equalsIgnoreCase(grantType)) {
            privilegeGrantQo.setGrantTypes(List.of(GrantType.FORCE_USE, GrantType.AVAILABLE_USE));
        }
        else {
            privilegeGrantQo.setGrantType(grantType);
        }

        privilegeGrantQo.setGrantObjId(resourceId);
        privilegeGrantQo.setGrantObjType(GrantObjType.DIG_EMPLOYEE);

        List<PrivilegeGrant> authList = privilegeGrantService.findPrivilegeByQo(privilegeGrantQo);

        List<GrantSourceVo> grantSourceVos = new ArrayList<>(10);

        for (PrivilegeGrant privilegeGrant : authList) {

            String grantToType = privilegeGrant.getGrantToType();
            String grantToObjType = privilegeGrant.getGrantToObjType();
            Long grantToObjId = privilegeGrant.getGrantToObjId();

            GrantSourceVo grantSourceVo = new GrantSourceVo();
            grantSourceVo.setColor(grantToType);
            grantSourceVo.setGrantToObjId(grantToObjId);
            grantSourceVo.setGrantToObjType(grantToObjType);
            grantSourceVo.setGrantToObjName(authApplicationService.getName(grantToObjType, grantToObjId));
            grantSourceVos.add(grantSourceVo);
        }
        return grantSourceVos;
    }

}
