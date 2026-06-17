package com.iwhalecloud.byai.manager.domain.resource.service;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.constants.auth.GrantObjType;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.superassist.SuasSuperassistApplicationService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.resource.request.DigEmployeeRelResourceQo;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
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
import java.util.function.Function;
import java.util.stream.Collectors;

@Service
public class ResourceAuthApplicationService {

    private static final String BELONG_COMPANY = "COMPANY";

    private static final List<String> KNOWLEDGE_RESOURCE_BIZ_TYPES = List.of(
        Constants.ResourceBizType.KG_DOC,
        Constants.ResourceBizType.KG_QA,
        Constants.ResourceBizType.KG_TERM);

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

    @Autowired
    private SuasSuperassistApplicationService suasSuperassistApplicationService;

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
        if (qo == null) {
            PageInfo<ResourceAuthVo> pageInfo = new PageInfo<>();
            pageInfo.setList(Collections.emptyList());
            return pageInfo;
        }
        if (qo.getResourceId() == null) {
            qo.setResourceId(suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId());
        }
        if (qo.getResourceId() == null) {
            PageInfo<ResourceAuthVo> pageInfo = new PageInfo<>();
            pageInfo.setList(Collections.emptyList());
            return pageInfo;
        }
        String keyword = StringUtils.trimToNull(qo.getKeyword());
        qo.setKeyword(keyword);
        qo.setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(qo.getCatalogId()));
        Page<ResourceAuthVo> page = PageHelper.startPage(qo.getPageNum(), qo.getPageSize());
        if (isSkillOnlyQuery(qo.getResourceBizTypeList())) {
            ssResourceMapper.queryDigEmployeeSkillResourceAuthList(qo);
        }
        else {
            ssResourceMapper.queryDigEmployeeRelResourceAuthList(qo);
        }
        PageInfo<ResourceAuthVo> pageInfo = PageHelperUtil.toPageInfo(page);
        return pageInfo;
    }

    /**
     * 查询当前用户对指定数字员工关联知识库中具备管理权限的知识库。
     *
     * 这里不复用普通“数字员工关联资源列表”的分页结果再过滤，否则可能出现第一页被权限过滤空、
     * 后续页其实有可管理知识库的问题。先取完整候选集，再按后端统一管理权限口径过滤，最后手动分页。
     */
    public PageInfo<ResourceAuthVo> listDigitalEmployeeManageKnowledgeResourceAuth(DigEmployeeRelResourceQo qo) {
        if (qo == null) {
            return PageHelperUtil.emptyPage(1L, 10L);
        }
        if (qo.getResourceId() == null) {
            qo.setResourceId(suasSuperassistApplicationService.resolveCurrentUserDefaultDigitalEmployeeId());
        }
        if (qo.getResourceId() == null) {
            return PageHelperUtil.emptyPage(safeLong(qo.getPageNum(), 1L), safeLong(qo.getPageSize(), 10L));
        }

        qo.setKeyword(StringUtils.trimToNull(qo.getKeyword()));
        qo.setResourceBizTypeList(KNOWLEDGE_RESOURCE_BIZ_TYPES);
        qo.setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(qo.getCatalogId()));

        List<ResourceAuthVo> candidateResources = ssResourceMapper.queryDigEmployeeRelResourceAuthList(qo);
        if (CollectionUtils.isEmpty(candidateResources)) {
            return PageHelperUtil.emptyPage(safeLong(qo.getPageNum(), 1L), safeLong(qo.getPageSize(), 10L));
        }

        Map<Long, SsResource> resourceMap = loadResourceMap(candidateResources);
        List<ResourceAuthVo> manageableResources = candidateResources.stream()
            .filter(item -> hasManagePermission(item, resourceMap))
            .collect(Collectors.toList());

        return buildPagedResourceAuth(manageableResources, qo.getPageNum(), qo.getPageSize());
    }

    private Map<Long, SsResource> loadResourceMap(List<ResourceAuthVo> candidateResources) {
        List<Long> resourceIds = candidateResources.stream()
            .map(ResourceAuthVo::getResourceId)
            .filter(java.util.Objects::nonNull)
            .distinct()
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(resourceIds)) {
            return Collections.emptyMap();
        }
        return ssResourceMapper.selectBatchIds(resourceIds).stream()
            .collect(Collectors.toMap(SsResource::getResourceId, Function.identity(), (left, right) -> left));
    }

    private boolean hasManagePermission(ResourceAuthVo item, Map<Long, SsResource> resourceMap) {
        if (item == null || item.getResourceId() == null) {
            return false;
        }
        SsResource resource = resourceMap.get(item.getResourceId());
        return authApplicationService.hasResourceManagePermission(resource);
    }

    private PageInfo<ResourceAuthVo> buildPagedResourceAuth(List<ResourceAuthVo> resources, Integer pageNum,
        Integer pageSize) {
        int safePageNum = pageNum == null || pageNum < 1 ? 1 : pageNum;
        int safePageSize = pageSize == null || pageSize < 1 ? 10 : pageSize;
        int total = resources.size();
        int fromIndex = Math.min((safePageNum - 1) * safePageSize, total);
        int toIndex = Math.min(fromIndex + safePageSize, total);

        PageInfo<ResourceAuthVo> pageInfo = new PageInfo<>();
        pageInfo.setPageNum(safePageNum);
        pageInfo.setPageSize(safePageSize);
        pageInfo.setTotal(total);
        pageInfo.setTotalPages((int) Math.ceil((double) total / safePageSize));
        pageInfo.setList(resources.subList(fromIndex, toIndex));
        return pageInfo;
    }

    private long safeLong(Integer value, long defaultValue) {
        return value == null ? defaultValue : value.longValue();
    }

    private boolean isSkillOnlyQuery(List<String> resourceBizTypeList) {
        if (CollectionUtils.isEmpty(resourceBizTypeList)) {
            return false;
        }
        List<String> normalizedBizTypes = resourceBizTypeList.stream()
            .filter(StringUtils::isNotBlank)
            .map(StringUtils::trim)
            .toList();
        return normalizedBizTypes.size() == 1 && StringUtils.equalsIgnoreCase(normalizedBizTypes.get(0), "SKILL");
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
