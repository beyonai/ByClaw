package com.iwhalecloud.byai.state.application.service.index;

import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.domain.agent.enums.OrgFilterType;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.qo.index.AuthResourceQo;
import com.iwhalecloud.byai.manager.qo.index.DiscoverQo;
import com.iwhalecloud.byai.manager.qo.index.HotQo;
import com.iwhalecloud.byai.manager.qo.index.MyAuthEmployQo;
import com.iwhalecloud.byai.manager.qo.index.MyCreatedQo;
import com.iwhalecloud.byai.manager.qo.index.MyUsualQo;
import com.iwhalecloud.byai.manager.qo.index.OrgFilterQo;
import com.iwhalecloud.byai.manager.qo.index.RecentlyAddedQo;
import com.iwhalecloud.byai.state.domain.index.service.IndexService;
import com.iwhalecloud.byai.manager.vo.index.AuthDigitEmployVo;
import com.iwhalecloud.byai.gateway.sandbox.service.SandboxService;
import com.iwhalecloud.byai.manager.vo.index.AuthResourceVo;
import com.iwhalecloud.byai.manager.vo.index.DepartmentRangeVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketExtVo;
import com.iwhalecloud.byai.manager.vo.index.DigitEmployMarketVo;
import com.iwhalecloud.byai.manager.vo.index.ManPrivVo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.state.common.constant.GrantToObjTypeConstants;
import com.iwhalecloud.byai.state.common.share.bean.Organization;
import com.iwhalecloud.byai.state.common.share.helper.ShareCacheUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Comparator;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.collections4.ListUtils;
import org.apache.commons.lang3.time.DateUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * 数字员工首页应用服务V2
 *
 * @author zht
 * @version 1.0
 * @date 2025/4/25
 */
@Service
public class IndexApplicationServiceV2 {

    public static final Logger logger = LoggerFactory.getLogger(IndexApplicationServiceV2.class);

    @Autowired
    private IndexService indexService;

    @Autowired
    private ResourceAuthContextService resourceAuthContextService;

    @Autowired
    private SandboxService sandboxService;

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    @Autowired
    private SuasSuperassistService suasSuperassistService;

    private static final String SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX = "_main";

    /**
     * 查询当前用户创建和订阅的数字员工分页列表。
     *
     * @param myAuthEmployQo 查询条件
     * @return 分页结果
     */

    public PageInfo<AuthDigitEmployVo> queryMyAuthEmploy(MyAuthEmployQo myAuthEmployQo) {

        resourceAuthContextService.setCurrentUserAuthQo(myAuthEmployQo);

        // 按用户近 90 天使用频次降序排列
        myAuthEmployQo.setRecentlyStartDate(DateUtils.addDays(new Date(), -90));

        Page<AuthDigitEmployVo> page = PageHelper.startPage(myAuthEmployQo.getPageNum(), myAuthEmployQo.getPageSize());
        List<AuthDigitEmployVo> authDigitEmployVos = indexService.selectAuthDigitEmploy(myAuthEmployQo);

        // 为每个数字员工设置是否有记忆（优化：批量查询）
        Long defaultDigitalEmployeeId = resolveCurrentUserDefaultDigitalEmployeeId();
        for (AuthDigitEmployVo authDigitEmployVo : authDigitEmployVos) {
            this.setIsMyCreate(authDigitEmployVo);
            this.fillDefaultAndRuntimeTag(authDigitEmployVo, defaultDigitalEmployeeId);
        }

        PageInfo<AuthDigitEmployVo> pageInfo = PageHelperUtil.toPageInfo(page);

        // 处理沙箱类型资源，为sandbox类型的资源创建或获取沙箱环境
        try {
            sandboxService.processSandboxForAuthDigitEmployVos(pageInfo.getList());
        }
        catch (Exception e) {
            logger.error("处理沙箱类型资源异常", e);
        }

        return pageInfo;
    }

    /**
     * 标记是否是我创建的
     *
     * @param authDigitEmployVo 授权资源标识
     */
    private void setIsMyCreate(AuthDigitEmployVo authDigitEmployVo) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (Objects.equals(userId, authDigitEmployVo.getCreatorId())) {
            authDigitEmployVo.setMyCreate(true);
        }
    }

    /**
     * 左侧“全部列表项”的默认关系来自 suas_superassist.default_dig_employee_id。
     * 这里在服务层按当前用户查一次并回填列表，避免把超级助手表关联散落到列表 SQL 中。
     *
     * @return 当前用户绑定的默认数字员工资源 ID
     */
    private Long resolveCurrentUserDefaultDigitalEmployeeId() {
        Long defaultDigEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        if (defaultDigEmployeeId != null) {
            return defaultDigEmployeeId;
        }
        Long assistantId = CurrentUserHolder.getAssistantId();
        if (assistantId == null || assistantId <= 0) {
            assistantId = CurrentUserHolder.getCurrentUserId();
        }
        if (assistantId == null || assistantId <= 0) {
            return null;
        }
        SuasSuperassist suasSuperassist = suasSuperassistService.findById(assistantId);
        return suasSuperassist == null ? null : suasSuperassist.getDefaultDigEmployeeId();
    }

    /**
     * 回填左侧列表专用的运行时展示字段：
     * 1. isDefault/canSetDefault 只根据当前用户默认数字员工 ID 判断；
     * 2. tagName 不再依赖扩展表落库值，按 ownerType/resourceCode/agentType 运行时计算。
     */
    private void fillDefaultAndRuntimeTag(AuthDigitEmployVo authDigitEmployVo, Long defaultDigitalEmployeeId) {
        if (authDigitEmployVo == null) {
            return;
        }
        boolean isDefault = defaultDigitalEmployeeId != null
            && Objects.equals(authDigitEmployVo.getId(), defaultDigitalEmployeeId);
        authDigitEmployVo.setIsDefault(isDefault);
        authDigitEmployVo.setCanSetDefault(!isDefault);
        authDigitEmployVo.setTagName(buildRuntimeDigitalEmployeeTagName(authDigitEmployVo.getOwnerType(),
            authDigitEmployVo.getResourceCode(), authDigitEmployVo.getAgentType()));
    }

    private void fillRuntimeTag(DigitEmployMarketVo digitEmployMarketVo) {
        if (digitEmployMarketVo == null) {
            return;
        }
        digitEmployMarketVo.setTagName(buildRuntimeDigitalEmployeeTagName(digitEmployMarketVo.getOwnerType(),
            digitEmployMarketVo.getResourceCode(), digitEmployMarketVo.getAgentType()));
    }

    /**
     * 数字员工标签统一运行时生成：个人侧按超级助手/个人助理展示，企业侧按 agentType 展示类型。
     */
    private String buildRuntimeDigitalEmployeeTagName(String ownerType, String resourceCode, String agentType) {
        if (OwnerType.PERSONAL.equals(ownerType) || OwnerType.PERSONAL_DEFAULT.equals(ownerType)) {
            return StringUtils.endsWith(resourceCode, SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX)
                ? I18nUtil.get("digemployee.tag.super.assistant")
                : I18nUtil.get("digemployee.tag.personal.assistant");
        }
        if (OwnerType.ENTERPRISE.equals(ownerType)) {
            DigitalEmployType digitalEmployType = DigitalEmployType.getByCode(agentType);
            return digitalEmployType == null ? null : I18nUtil.get(getEnterpriseDigitalEmployeeTagNameKey(digitalEmployType));
        }
        return null;
    }

    private String getEnterpriseDigitalEmployeeTagNameKey(DigitalEmployType digitalEmployType) {
        return switch (digitalEmployType) {
            case AGENT_TYPE_ASSISTANT -> "digemployee.tag.agent.assistant";
            case AGENT_TYPE_DATA -> "digemployee.tag.agent.data";
            case AGENT_TYPE_QA -> "digemployee.tag.agent.qa";
            case AGENT_TYPE_DEBUG -> "digemployee.tag.agent.debug";
            case AGENT_TYPE_CODE -> "digemployee.tag.agent.code";
        };
    }

    /**
     * 查询我的常用数字员工列表。 包含红名单授权且不在黑名单中的数字员工，（按用户近 90 天使用频次降序排列）
     *
     * @param myUsualQo 查询条件，包含用户ID和组织ID列表
     * @return 常用数字员工列表
     */
    public PageInfo<AuthDigitEmployVo> queryMyUsual(MyUsualQo myUsualQo) {

        resourceAuthContextService.setCurrentUserAuthQo(myUsualQo);

        Page<AuthDigitEmployVo> page = PageHelper.startPage(myUsualQo.getPageNum(), myUsualQo.getPageSize());

        // 按用户近 90 天使用频次降序排列
        myUsualQo.setRecentlyStartDate(DateUtils.addDays(new Date(), -90));

        indexService.queryMyUsual(myUsualQo);

        PageInfo<AuthDigitEmployVo> pageInfo = PageHelperUtil.toPageInfo(page);

        // 标记是否我常用的
        List<AuthDigitEmployVo> authDigitEmployVos = pageInfo.getList();
        for (AuthDigitEmployVo authDigitEmployVo : authDigitEmployVos) {
            this.setIsMyCreate(authDigitEmployVo);
        }

        return pageInfo;
    }

    /**
     * 查询最近新增的数字员工列表。 包含红名单授权且不在黑名单中的数字员工，按最新授权时间和创建时间倒序排序。
     *
     * @param recentlyAddedQo 查询条件，包含用户ID和组织ID列表
     * @return 最近新增的数字员工列表
     */
    public PageInfo<AuthDigitEmployVo> queryRecentlyAdded(RecentlyAddedQo recentlyAddedQo) {

        resourceAuthContextService.setCurrentUserAuthQo(recentlyAddedQo);

        Integer pageNum = recentlyAddedQo.getPageNum();
        Integer pageSize = recentlyAddedQo.getPageSize();
        Page<AuthDigitEmployVo> page = PageHelper.startPage(pageNum, pageSize);
        indexService.queryRecentlyAdded(recentlyAddedQo);

        PageInfo<AuthDigitEmployVo> pageInfo = PageHelperUtil.toPageInfo(page);

        List<AuthDigitEmployVo> authDigitEmployVos = pageInfo.getList();

        // 为每个数字员工添加知识和技能统计信息
        this.fillResourceStatsForAuthDigitEmployVos(authDigitEmployVos);

        for (AuthDigitEmployVo authDigitEmployVo : authDigitEmployVos) {
            this.setIsMyCreate(authDigitEmployVo);
        }

        return pageInfo;
    }

    /**
     * 查询当前用户创建且已上架的数字员工列表。
     *
     * @param myCreatedQo 查询条件，包含分页信息
     * @return 数字员工分页列表
     */
    public PageInfo<DigitEmployMarketVo> queryMyCreated(MyCreatedQo myCreatedQo) {

        myCreatedQo.setUserId(CurrentUserHolder.getCurrentUserId());
        fillCatalogIds(myCreatedQo);

        Page<DigitEmployMarketVo> page = PageHelper.startPage(myCreatedQo.getPageNum(), myCreatedQo.getPageSize());
        List<DigitEmployMarketVo> digitEmployMarketVos = indexService.queryMyCreated(myCreatedQo);
        for (DigitEmployMarketVo digitEmployMarketVo : digitEmployMarketVos) {
            digitEmployMarketVo.setMyCreate(true);
            digitEmployMarketVo.setManUserName(this.buildManUserName(digitEmployMarketVo.getManUserId()));
            // 设置管理/使用权限信息
            this.setManOrUsePriv(digitEmployMarketVo);
        }

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 设置管理用户权限
     *
     * @param digitEmployMarketVo 授权数字员工信息
     */
    private void setManOrUsePriv(DigitEmployMarketVo digitEmployMarketVo) {
        if (digitEmployMarketVo.getUseCount() != null && digitEmployMarketVo.getUseCount() > 0) {
            digitEmployMarketVo.setGrantType(GrantToObjTypeConstants.AVAILABLE_USE);
        }
        if (digitEmployMarketVo.getFocusCount() != null && digitEmployMarketVo.getFocusCount() > 0) {
            digitEmployMarketVo.setGrantType(GrantToObjTypeConstants.FORCE_PRIV);
        }
    }

    /**
     * 根据用户ID字符串构建用户名称列表。 将逗号分隔的用户ID转换为对应的用户名称，以逗号拼接返回。
     *
     * @param manUserId 用户ID字符串，多个ID以逗号分隔
     * @return 用户名称字符串，多个名称以逗号分隔
     */
    private String buildManUserName(String manUserId) {
        List<Long> longs = StringUtil.splitLong(manUserId, ",");
        List<String> nameList = new ArrayList<>(10);
        for (Long userId : longs) {
            ShareBfmUser userInfo = ShareCacheUtil.getShareBfmUser(userId);
            if (userInfo == null) {
                continue;
            }
            nameList.add(userInfo.getUserName());
        }
        return StringUtils.join(nameList, ",");
    }

    /**
     * 查询数字员工发现页列表。
     *
     * @param discoverQo 发现页查询条件
     * @return 数字员工分页信息
     */
    public PageInfo<DigitEmployMarketVo> discover(DiscoverQo discoverQo) {

        // 设置过滤的组织发布范围
        discoverQo.setPublishOrgIds(this.getPublishOrgIds(discoverQo.getOrgFilters()));
        fillCatalogIds(discoverQo);

        // 设置用户信息
        resourceAuthContextService.setCurrentUserAuthQo(discoverQo);

        Page<DigitEmployMarketVo> page = PageHelper.startPage(discoverQo.getPageNum(), discoverQo.getPageSize());
        List<DigitEmployMarketExtVo> discoverList = indexService.discover(discoverQo);

        Map<Long, DigitEmployMarketVo> digitEmployMarketVoMap = new HashMap<>(10);

        for (DigitEmployMarketExtVo digitEmployMarketVo : discoverList) {
            // 设置权限状态
            this.buildPermissionStatus(digitEmployMarketVo);
            this.fillRuntimeTag(digitEmployMarketVo);

            digitEmployMarketVoMap.put(digitEmployMarketVo.getId(), digitEmployMarketVo);
        }

        // 为每个数字员工添加知识和技能统计信息
        fillResourceStatsForDiscoverList(discoverList);

        // 查询管理权限用户信息拼接
        Map<Long, List<ManPrivVo>> manPrivVoMap = indexService.findManPrivVo(digitEmployMarketVoMap.keySet());
        for (Map.Entry<Long, List<ManPrivVo>> entry : manPrivVoMap.entrySet()) {

            Long grantObjId = entry.getKey();
            List<ManPrivVo> manPrivVos = entry.getValue();

            DigitEmployMarketVo digitEmployMarketVo = digitEmployMarketVoMap.get(grantObjId);
            if (digitEmployMarketVo == null || ListUtil.isEmpty(manPrivVos)) {
                continue;
            }

            this.setManPriv(digitEmployMarketVo, manPrivVos);

        }

        return PageHelperUtil.toPageInfo(page);

    }

    private void fillCatalogIds(DiscoverQo discoverQo) {
        if (discoverQo == null || discoverQo.getCatalogId() == null) {
            return;
        }
        discoverQo.setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(discoverQo.getCatalogId()));
    }

    private void fillCatalogIds(MyCreatedQo myCreatedQo) {
        if (myCreatedQo == null || myCreatedQo.getCatalogId() == null) {
            return;
        }
        myCreatedQo.setCatalogIds(ssResourceCatalogService.findSelfAndDescendantCatalogIds(myCreatedQo.getCatalogId()));
    }

    private void fillResourceStatsForDiscoverList(List<DigitEmployMarketExtVo> discoverList) {
        if (CollectionUtils.isEmpty(discoverList)) {
            return;
        }

        try {
            // 提取所有数字员工ID
            List<Long> employeeIds = discoverList.stream().map(DigitEmployMarketExtVo::getId).filter(Objects::nonNull)
                .distinct().collect(Collectors.toList());

            if (employeeIds.isEmpty()) {
                return;
            }

            // 通过Feign调用统计接口获取知识和技能数量
            Map<String, Object> params = new HashMap<>();
            params.put("resourceIds", employeeIds);
            // todo

            logger.debug("为 {} 个数字员工填充了知识和技能统计信息", discoverList.size());

        }
        catch (Exception e) {
            logger.error("填充知识和技能统计信息失败", e);
            // 出错时设置默认值0，不影响正常功能
            for (DigitEmployMarketExtVo vo : discoverList) {
                vo.setKnowledgeCount(0);
                vo.setSkillsCount(0);
            }
        }
    }

    /**
     * 设置管理授权用户信息
     *
     * @param digitEmployMarketVo 查询对象
     * @param manPrivVos 管理用户权限
     */
    private void setManPriv(DigitEmployMarketVo digitEmployMarketVo, List<ManPrivVo> manPrivVos) {

        Set<Long> manPrivIds = new LinkedHashSet<>(manPrivVos.size());
        Set<String> manPrivNames = new LinkedHashSet<>(manPrivVos.size());

        for (ManPrivVo manPrivVo : manPrivVos) {
            manPrivIds.add(manPrivVo.getManPrivId());
            manPrivNames.add(manPrivVo.getManPrivName());
        }

        digitEmployMarketVo.setManPrivIds(StringUtils.join(manPrivIds, ","));
        digitEmployMarketVo.setManPrivNames(StringUtils.join(manPrivNames, ","));
    }

    /**
     * 设置权限状态
     *
     * @param digitEmployMarketVo 数字员工对象
     */
    private void buildPermissionStatus(DigitEmployMarketExtVo digitEmployMarketVo) {

        Long userId = CurrentUserHolder.getCurrentUserId();

        if (Objects.equals(userId, digitEmployMarketVo.getCreatorId())) {
            digitEmployMarketVo.setUsesPermissions(true);
            digitEmployMarketVo.setMyCreate(true);
        }

        // 设置管理员名称
        String manUserId = digitEmployMarketVo.getManUserId();
        digitEmployMarketVo.setManUserName(this.buildManUserName(manUserId));

        // 是否管有管理权限
        List<Long> longs = StringUtil.splitLong(manUserId, ",");
        digitEmployMarketVo.setManagePermissions(longs.contains(CurrentUserHolder.getCurrentUserId()));

        // 授权给我的，排除我创建的 授权给我的（后台授权的+前台申请的）
        if ((digitEmployMarketVo.getForceUseCount() > 0 || digitEmployMarketVo.getAvailableUseCount() > 0)
            && !digitEmployMarketVo.isMyCreate()) {
            digitEmployMarketVo.setAuthorizeMe(true);
        }

        // 存在申请审核
        if (digitEmployMarketVo.getApproveStatusCount() > 0) {
            digitEmployMarketVo.setApproveStatus("S");
        }
        else if (digitEmployMarketVo.getRedCount() > 0 && digitEmployMarketVo.getBlackCount() <= 0) {
            digitEmployMarketVo.setUsesPermissions(true);
            digitEmployMarketVo.setApproveStatus("A");
        }

        // 是否在此订阅
        if (digitEmployMarketVo.getAvailableUseCount() > 0) {
            digitEmployMarketVo.setGrantType(GrantToObjTypeConstants.AVAILABLE_USE);
        }

        if (digitEmployMarketVo.getForceUseCount() > 0) {
            digitEmployMarketVo.setGrantType(GrantToObjTypeConstants.FORCE_PRIV);
        }

    }

    /**
     * 获取发布范围内的组织
     *
     * @param orgFilters 组织过滤对象
     * @return Collection<Long>
     */
    private Collection<Long> getPublishOrgIds(List<OrgFilterQo> orgFilters) {

        Set<Long> publishOrgIds = new HashSet<>(orgFilters.size());
        for (OrgFilterQo orgFilterQo : orgFilters) {
            String type = orgFilterQo.getType();
            Long objectId = orgFilterQo.getObjectId();

            // 公司范围查询所有一级组织
            if (OrgFilterType.COMPANY.equalsIgnoreCase(type)) {
                return indexService.findTopOrgId();
            }
            else if (objectId != null) {
                publishOrgIds.add(objectId);
            }
        }
        return publishOrgIds;
    }

    /**
     * 查询热门对象
     *
     * @param hotQo 查询对象
     * @return ResponseUtil
     */
    public PageInfo<DigitEmployMarketVo> queryPopular(HotQo hotQo) {
        hotQo.setOrderField("use");
        hotQo.setOrderBy("desc");
        return this.discover(hotQo);
    }

    /**
     * 查询我的组织范围。 查询用户的组织信息，排除顶级组织后返回 ，但是如果排除后的结果为空，则不排除
     *
     * @return 组织范围列表
     */
    public List<DepartmentRangeVo> queryMyDepartmentRange() {

        List<UsersOrganization> usersOrganizations = CurrentUserHolder.getUsersOrganizations();
        if (ListUtil.isEmpty(usersOrganizations)) {
            return Collections.emptyList();
        }

        // 将组织列表转换为Map，key为组织ID
        Map<Long, DepartmentRangeVo> departmentRangeVoMap = new HashMap<>();
        for (UsersOrganization usersOrganization : usersOrganizations) {
            String pathCode = usersOrganization.getPathCode();
            List<Long> orgIds = StringUtil.splitLong(pathCode, "\\.");
            for (Long orgId : orgIds) {
                Organization organization = ShareCacheUtil.getShareOrganization(orgId);
                if (organization == null) {
                    continue;
                }
                DepartmentRangeVo departmentRangeVo = new DepartmentRangeVo();
                departmentRangeVo.setOrgId(organization.getOrgId());
                departmentRangeVo.setOrgName(organization.getOrgName());
                departmentRangeVo.setParentOrgId(organization.getParentOrgId());
                departmentRangeVo.setOrgLevel(organization.getOrgLevel());
                departmentRangeVo.setPathCode(organization.getPathCode());
                departmentRangeVoMap.put(departmentRangeVo.getOrgId(), departmentRangeVo);
            }
        }

        // 查询顶级组织ID列表
        List<Long> topOrgId = indexService.findTopOrgId();

        // 从组织ID集合中排除顶级组织ID
        List<Long> subtract = ListUtils.subtract(List.copyOf(departmentRangeVoMap.keySet()), topOrgId);

        // 确定最终需要返回的组织ID列表：如果排除后不为空则使用排除后的结果，否则使用全部
        List<Long> orgIds = ListUtil.isNotEmpty(subtract) ? subtract : List.copyOf(departmentRangeVoMap.keySet());

        // 从 departmentRangeVoMap 中过滤出 orgId 在 orgIds 集合中的组织，并按 orgLevel 升序排序（使用 Stream API）
        return orgIds.stream().map(departmentRangeVoMap::get).filter(Objects::nonNull)
            .sorted(Comparator.comparing(DepartmentRangeVo::getOrgLevel)).collect(Collectors.toList());
    }

    /**
     * 查询授权的文档
     *
     * @param authResourceQo 查询对象
     * @return ResponseUtil
     */
    public PageInfo<AuthResourceVo> queryAuthDoc(AuthResourceQo authResourceQo) {
        // 设置用户红黑名单过滤
        resourceAuthContextService.setCurrentUserAuthQo(authResourceQo);

        return indexService.queryAuthDoc(authResourceQo);
    }

    /**
     * 查询授权的工具
     *
     * @return ResponseUtil
     */
    public PageInfo<AuthResourceVo> queryAuthTools(AuthResourceQo authResourceQo) {

        // 设置用户红黑名单过滤
        resourceAuthContextService.setCurrentUserAuthQo(authResourceQo);

        Page<AuthResourceVo> page = PageHelper.startPage(authResourceQo.getPageNum(), authResourceQo.getPageSize());
        indexService.queryAuthTools(authResourceQo);

        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 为AuthDigitEmployVo列表填充知识和技能统计信息
     *
     * @param authDigitEmployVos 数字员工VO列表
     */
    private void fillResourceStatsForAuthDigitEmployVos(List<AuthDigitEmployVo> authDigitEmployVos) {
        if (CollectionUtils.isEmpty(authDigitEmployVos)) {
            return;
        }
    }

}
