package com.iwhalecloud.byai.manager.application.service.auth;

import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.Arrays;
import java.util.Objects;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.auth.enums.Color;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjType;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantToObjTypeMapping;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantType;
import com.iwhalecloud.byai.manager.domain.auth.enums.GrantTypeRangeMapping;
import com.iwhalecloud.byai.manager.domain.auth.enums.OperType;
import com.iwhalecloud.byai.manager.domain.auth.enums.ResourceTypeValueMapping;
import com.iwhalecloud.byai.manager.domain.auth.service.PrivilegeGrantService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDocService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtAgentService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtMcpService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtObjectService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolKitService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtToolService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtViewService;
import com.iwhalecloud.byai.manager.domain.resource.service.SuperassistSubAgentService;
import com.iwhalecloud.byai.manager.domain.station.service.StationService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.auth.AuthDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthManOrgDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.dto.auth.ManOrgDTO;
import com.iwhalecloud.byai.manager.dto.auth.PriviledgeQo;
import com.iwhalecloud.byai.manager.dto.position.PositionDTO;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.station.Station;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.auth.PrivilegeGrantMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.auth.AuthDetailQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthManQo;
import com.iwhalecloud.byai.manager.qo.auth.PrivilegeGrantQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberQueryQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyQo;
import com.iwhalecloud.byai.manager.qo.resource.PrivListQo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.auth.GrantObjType;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.CompletionsUtils;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import com.iwhalecloud.byai.manager.vo.auth.AuthVo;
import com.iwhalecloud.byai.manager.vo.auth.CompareVo;
import com.iwhalecloud.byai.manager.vo.auth.FixedEntryOperationCapabilityVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceUseApplyItemVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberItemVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberQueryResultVo;
import com.iwhalecloud.byai.common.constants.Constants;
import java.util.ArrayList;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.stream.Collectors;
import com.iwhalecloud.byai.common.feign.response.knowledge.DirectUnsubscribeDto;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.scheduling.annotation.Async;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;

/**
 * 认证应用服务
 */
@Service
public class AuthApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(AuthApplicationService.class);

    private static final String USE_APPLY_PENDING_STATUS = "P";

    private static final String USE_APPLY_PENDING_LABEL_KEY = "auth.use.apply.status.pending";

    private static final String DEFAULT_SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX = "_main";

    private static final Set<String> MANAGE_USE_INHERIT_TARGET_TYPES = Set.of(GrantToObjType.USER, GrantToObjType.ORG,
        GrantToObjType.POST, GrantToObjType.STATION);

    @Value("${dataset.system:}")
    private String datasetSystem;

    @Autowired
    private PrivilegeGrantMapper privilegeGrantMapper;

    @Autowired
    private PrivilegeGrantService privilegeGrantService;

    @Autowired
    private UserService userService;

    @Autowired
    private PositionService positionService;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private StationService stationService;

    @Autowired
    private SuperassistSubAgentService superassistSubAgentService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResExtToolService ssResExtToolService;

    @Autowired
    private SsResExtToolKitService ssResExtToolKitService;

    @Autowired
    private SsResExtMcpService ssResExtMcpService;

    @Autowired
    private SsResExtAgentService ssResExtAgentService;

    @Autowired
    private SsResExtObjectService ssResExtObjectService;

    @Autowired
    private SsResExtViewService ssResExtViewService;

    @Autowired
    private SsResExtDocService ssResExtDocService;

    @Autowired
    private AuthRedisApplicationService authRedisApplicationService;

    /**
     * 使用@Lazy解决与AuthRedisSyncService的循环依赖问题 AuthRedisSyncService需要调用AuthApplicationService.buildUserAuthResources()
     */
    @Autowired
    @Lazy
    private AuthRedisSyncService authRedisSyncService;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 构建用户资源权限Map，按resourceType分组 查询用户所有有效授权，过滤黑名单后返回资源权限映射
     *
     * @param userId 用户标识
     * @return 资源权限映射，key为resourceId（String），value为resourceType
     */
    public Map<String, String> buildUserAuthResources(Long userId) {
        if (userId == null) {
            return new HashMap<>();
        }

        // 查询用户所有来源的授权（USER直接授权 + ORG组织授权 + POST岗位授权 + STATION驻地授权）
        List<String> grantTypes = Arrays.asList(GrantType.AVAILABLE_USE, GrantType.FORCE_USE);
        List<PrivilegeGrant> authList = listAuthPrivilegeGrant(null, null, GrantToObjType.USER, userId, grantTypes);

        if (CollectionUtils.isEmpty(authList)) {
            return new HashMap<>();
        }

        // 按resourceId分组处理权限
        Map<Long, List<PrivilegeGrant>> authByResource = authList.stream().filter(item -> null != item.getGrantObjId())
            .collect(Collectors.groupingBy(PrivilegeGrant::getGrantObjId));

        // 构建结果Map：resourceId -> resourceType
        Map<String, String> result = new HashMap<>();
        for (Map.Entry<Long, List<PrivilegeGrant>> entry : authByResource.entrySet()) {
            Long resourceId = entry.getKey();
            List<PrivilegeGrant> resourceAuths = entry.getValue();

            // 检查是否有红名单权限
            boolean hasRedAuth = resourceAuths.stream().anyMatch(auth -> Color.RED.equals(auth.getGrantToType()));

            // 检查是否有黑名单权限
            boolean hasBlackAuth = resourceAuths.stream().anyMatch(auth -> Color.BLACK.equals(auth.getGrantToType()));

            // 黑名单优先级更高：有红名单且无黑名单才有权限
            if (hasRedAuth && !hasBlackAuth) {
                // 取第一个红名单的grantObjType作为资源类型
                String resourceType = resourceAuths.stream().filter(auth -> Color.RED.equals(auth.getGrantToType()))
                    .findFirst().map(PrivilegeGrant::getGrantObjType).orElse(null);
                if (resourceType != null) {
                    result.put(String.valueOf(resourceId), resourceType);
                }
            }
        }

        return result;
    }

    /**
     * 批量构建多个用户的资源权限Map 一次查询所有用户的授权记录，在内存中按userId分组并应用RED/BLACK过滤
     *
     * @param userIds 用户ID集合
     * @return Map<userId, Map<resourceId, resourceType>>
     * @deprecated 仅查询grantToObjType=USER的直接授权，遗漏ORG/POST/STATION继承授权。请改用逐用户调用 {@link #buildUserAuthResources(Long)}
     */
    @Deprecated
    public Map<Long, Map<String, String>> buildBatchUserAuthResources(Collection<Long> userIds) {
        Map<Long, Map<String, String>> result = new HashMap<>();
        if (CollectionUtils.isEmpty(userIds)) {
            return result;
        }

        // 一次查询所有用户的授权（grantToObjType=USER + grantToObjIds=userIds）
        PrivilegeGrantQo qo = new PrivilegeGrantQo();
        qo.setGrantToObjType(GrantToObjType.USER);
        qo.setGrantToObjIds(userIds);
        List<String> grantTypes = new ArrayList<>();
        grantTypes.add(GrantType.AVAILABLE_USE);
        grantTypes.add(GrantType.FORCE_USE);
        qo.setGrantTypes(grantTypes);

        List<PrivilegeGrant> allAuthList = privilegeGrantService.findPrivilegeByQo(qo);
        if (CollectionUtils.isEmpty(allAuthList)) {
            // 所有用户都无权限，返回空map（让调用方为每个用户写空缓存）
            for (Long userId : userIds) {
                result.put(userId, new HashMap<>());
            }
            return result;
        }

        // 按 grantToObjId（即userId）分组
        Map<Long, List<PrivilegeGrant>> authByUser = allAuthList.stream().filter(item -> item.getGrantToObjId() != null)
            .collect(Collectors.groupingBy(PrivilegeGrant::getGrantToObjId));

        // 对每个用户应用RED/BLACK过滤逻辑
        for (Long userId : userIds) {
            List<PrivilegeGrant> userAuthList = authByUser.get(userId);
            if (CollectionUtils.isEmpty(userAuthList)) {
                result.put(userId, new HashMap<>());
                continue;
            }

            // 按resourceId（grantObjId）分组
            Map<Long, List<PrivilegeGrant>> authByResource = userAuthList.stream()
                .filter(item -> item.getGrantObjId() != null)
                .collect(Collectors.groupingBy(PrivilegeGrant::getGrantObjId));

            Map<String, String> userResult = new HashMap<>();
            for (Map.Entry<Long, List<PrivilegeGrant>> entry : authByResource.entrySet()) {
                Long resourceId = entry.getKey();
                List<PrivilegeGrant> resourceAuths = entry.getValue();

                boolean hasRedAuth = resourceAuths.stream().anyMatch(auth -> Color.RED.equals(auth.getGrantToType()));
                boolean hasBlackAuth = resourceAuths.stream()
                    .anyMatch(auth -> Color.BLACK.equals(auth.getGrantToType()));

                if (hasRedAuth && !hasBlackAuth) {
                    String resourceType = resourceAuths.stream().filter(auth -> Color.RED.equals(auth.getGrantToType()))
                        .findFirst().map(PrivilegeGrant::getGrantObjType).orElse(null);
                    if (resourceType != null) {
                        userResult.put(String.valueOf(resourceId), resourceType);
                    }
                }
            }
            result.put(userId, userResult);
        }

        return result;
    }

    /**
     * 同步单个用户权限到Redis
     *
     * @param userId 用户标识
     */
    public void syncUserAuthToRedis(Long userId) {
        if (userId == null) {
            return;
        }

        try {
            Map<String, String> resourceAuthMap = buildUserAuthResources(userId);
            authRedisApplicationService.writeUserAuth(userId, resourceAuthMap);
            logger.info("同步用户{}权限到Redis完成，资源数量：{}", userId, resourceAuthMap.size());
        }
        catch (Exception e) {
            logger.error("同步用户{}权限到Redis失败：{}", userId, e.getMessage());
        }
    }

    /**
     * 查询资源的管理成员和使用成员
     *
     * @param qo 查询条件
     * @return 成员信息
     */
    public ResourceMemberQueryResultVo queryResourceMembers(ResourceMemberQueryQo qo) {
        // 第一步：先确认资源存在，并拿到资源真实类型。
        // 接口入参只保留 resourceId，这样可以避免前端传错 resourceBizType 导致查询口径不一致。
        SsResource ssResource = getRequiredResource(qo.getResourceId());

        ResourceMemberQueryResultVo result = new ResourceMemberQueryResultVo();
        result.setResourceBizType(ssResource.getResourceBizType());
        result.setExtInfo(buildResourceExtInfo(ssResource));

        // 第二步：查询管理授权(ALLOW_MANAGE)的全部授权对象。
        // 这里先查全量红黑名单，再在内存里统一做“红减黑”的有效名单处理，
        // 这样既能返回最终有效管理对象，也能把黑名单单独回给前端。
        List<ResourceMemberItemVo> managerRecords = queryResourceMemberRecords(ssResource,
            List.of(GrantType.ALLOW_MANAGE));
        result.setManagerList(filterEffectiveRedMembers(managerRecords));
        result.setManagerBlackList(filterBlackMembers(managerRecords));

        // 第三步：查询使用授权(AVAILABLE_USE + FORCE_USE)的全部授权对象。
        // 两种使用类授权都能让用户获得资源使用权限，因此这里要合并查询，
        // 最终由前端根据 grantType 区分是申请通过还是直接授权。
        List<ResourceMemberItemVo> useRecords = queryResourceMemberRecords(ssResource,
            List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE));
        result.setUseList(filterEffectiveRedMembers(useRecords));
        result.setUseBlackList(filterBlackMembers(useRecords));

        return result;
    }

    /**
     * 设置资源管理人员。 这里不直接操作 au_privilege_grant，而是统一复用 handleAuth(...)， 这样红黑名单比较、增删改、缓存同步都仍然走现有稳定链路。
     *
     * @param qo 设置入参
     */
    public void setResourceManagers(ResourceMemberSettingQo qo) {
        // 1. 校验资源存在并拿到真实资源类型。
        SsResource ssResource = getRequiredResource(qo.getResourceId());
        validateResourceManageAuthAllowed(ssResource);

        // 2. 统一校验当前用户是否具备维护该资源成员的权限。
        // 允许设置的人包括：平台管理员、资源创建人、资源管理人、资源归属组织管理员。
        validateResourceMemberSettingPermission(ssResource);

        // 3. 构造统一授权对象，并交给 handleAuth 做差异化更新。
        AuthRedBlackDTO authDto = buildResourceMemberAuthDto(ssResource, GrantType.ALLOW_MANAGE, qo);
        handleAuth(authDto);
    }

    /**
     * 设置资源使用人员。 当前项目里“后台直接授权可使用”实际落的是 FORCE_USE， 因此这里沿用同一口径，避免和现有 availableUseAuth 的行为产生分叉。
     *
     * @param qo 设置入参
     */
    public void setResourceUsers(ResourceMemberSettingQo qo) {
        // 1. 校验资源存在并拿到真实资源类型。
        SsResource ssResource = getRequiredResource(qo.getResourceId());
        validateDefaultSuperAssistantUseAuthAllowed(ssResource);

        // 2. 使用人员设置允许当前用户维护自己绑定的默认个人资源。
        validateResourceUseSettingPermission(ssResource);

        // 3. 使用人员设置按后台直接授权口径写入 FORCE_USE。
        AuthRedBlackDTO authDto = buildResourceMemberAuthDto(ssResource, GrantType.FORCE_USE, qo);
        handleAuth(authDto);

        // 4. 同步撤销本次授权用户在该资源上的待审申请（status_cd: P -> X），
        //    避免"用户已被直接授权但仍显示在审核列表/我申请中"的脏数据，与 approveUseApply 行为一致。
        autoCancelPendingApplyForGrantedUsers(ssResource, qo);
    }

    /**
     * 当 setResourceUsers 直接授权用户后，把该用户在同资源上原本 status_cd='P' 的待审申请
     * 自动置为 'X'（已撤销）。仅处理 USER 类型——applyUse 写死了 grantToObjType=USER。
     * @author qin.guoquan
     * @date 2026-05-06
     */
    private void autoCancelPendingApplyForGrantedUsers(SsResource ssResource, ResourceMemberSettingQo qo) {
        Set<Long> grantedUserIds = extractGrantedUserIds(qo);
        if (grantedUserIds.isEmpty()) {
            return;
        }
        PrivilegeGrant updates = new PrivilegeGrant();
        updates.setStatusCd("X");
        updates.setUpdateDate(new Date());

        LambdaUpdateWrapper<PrivilegeGrant> uw = new LambdaUpdateWrapper<>();
        uw.eq(PrivilegeGrant::getGrantObjType, ssResource.getResourceBizType())
            .eq(PrivilegeGrant::getGrantObjId, ssResource.getResourceId())
            .eq(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE)
            .eq(PrivilegeGrant::getGrantToType, Color.RED)
            .eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.USER)
            .in(PrivilegeGrant::getGrantToObjId, grantedUserIds)
            .eq(PrivilegeGrant::getStatusCd, USE_APPLY_PENDING_STATUS);
        privilegeGrantMapper.update(updates, uw);
    }

    /**
     * 从 setResourceUsers 入参的红名单成员中抽取 USER 类型的 grantToObjId 集合。
     */
    private Set<Long> extractGrantedUserIds(ResourceMemberSettingQo qo) {
        if (qo == null || qo.getRedList() == null || qo.getRedList().isEmpty()) {
            return Collections.emptySet();
        }
        return qo.getRedList().stream()
            .filter(item -> item != null
                && GrantToObjType.USER.equals(item.getGrantToObjType())
                && item.getGrantToObjId() != null)
            .map(AuthDTO::getGrantToObjId)
            .collect(Collectors.toSet());
    }

    /**
     * 提交资源使用申请。
     * 规则：
     * 1. 当前用户不在使用黑名单内才允许申请；
     * 2. 已有正式使用权限时不允许重复申请；
     * 3. 已有待审核申请时不允许重复申请。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    public void applyUse(ResourceUseApplyQo qo) {
        SsResource ssResource = getRequiredResource(qo.getResourceId());
        validateResourceUseApplyAllowed(ssResource);
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.not.login"));
        }
        validateCurrentUserCanApplyUse(ssResource, currentUserId);

        PrivilegeGrant privilegeGrant = new PrivilegeGrant();
        privilegeGrant.setGrantType(GrantType.AVAILABLE_USE);
        privilegeGrant.setGrantObjType(ssResource.getResourceBizType());
        privilegeGrant.setGrantObjId(ssResource.getResourceId());
        privilegeGrant.setGrantToObjId(currentUserId);
        privilegeGrant.setGrantToObjType(GrantToObjType.USER);
        privilegeGrant.setGrantToType(Color.RED);
        privilegeGrant.setOperType(OperType.READ);
        privilegeGrant.setStatusCd(USE_APPLY_PENDING_STATUS);
        privilegeGrantService.save(privilegeGrant);
    }

    /**
     * 查询资源待审核使用申请列表。
     * 仅资源管理人可查看。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    public List<ResourceUseApplyItemVo> queryUseApplyList(ResourceUseApplyQo qo) {
        SsResource ssResource = getRequiredResource(qo.getResourceId());
        validateResourceUseApplyAuditAllowed(ssResource);
        validateResourceUseSettingPermission(ssResource);

        List<PrivilegeGrant> pendingApplyList = listPendingUseApplyPrivileges(ssResource);
        if (CollectionUtils.isEmpty(pendingApplyList)) {
            return Collections.emptyList();
        }
        List<Long> userIds = pendingApplyList.stream()
            .map(PrivilegeGrant::getGrantToObjId)
            .filter(java.util.Objects::nonNull)
            .distinct()
            .collect(Collectors.toList());
        Map<Long, Users> userMap = usersMapper.selectBatchIds(userIds).stream()
            .collect(Collectors.toMap(Users::getUserId, item -> item, (left, right) -> left));
        return pendingApplyList.stream().map(item -> {
            ResourceUseApplyItemVo vo = new ResourceUseApplyItemVo();
            vo.setPrivilegeGrantId(item.getPrivilegeGrantId());
            vo.setUserId(item.getGrantToObjId());
            vo.setUserName(getUserDisplayName(userMap.get(item.getGrantToObjId())));
            vo.setApplyTime(item.getCreateDate());
            vo.setApplyStatus(I18nUtil.get(USE_APPLY_PENDING_LABEL_KEY));
            return vo;
        }).collect(Collectors.toList());
    }

    /**
     * 审核通过资源使用申请。
     * 处理规则：
     * 1. 当前操作人必须有资源管理权限；
     * 2. 将待审核申请记录置为失效；
     * 3. 给申请用户补一条正式 FORCE_USE 红名单权限。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    public void approveUseApply(ResourceUseApplyApproveQo qo) {
        SsResource ssResource = getRequiredResource(qo.getResourceId());
        validateResourceUseApplyAuditAllowed(ssResource);
        validateResourceUseSettingPermission(ssResource);

        PrivilegeGrant pendingApply = getPendingUseApplyPrivilege(ssResource, qo.getApplyUserId());
        if (pendingApply == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.use.apply.notfound.or.processed"));
        }

        if (!hasSameDimensionPermissionFamily(ssResource.getResourceBizType(), ssResource.getResourceId(),
            GrantToObjType.USER, qo.getApplyUserId(), List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE))) {
            PrivilegeGrant privilegeGrant = new PrivilegeGrant();
            privilegeGrant.setGrantType(GrantType.FORCE_USE);
            privilegeGrant.setGrantObjType(ssResource.getResourceBizType());
            privilegeGrant.setGrantObjId(ssResource.getResourceId());
            privilegeGrant.setGrantToObjId(qo.getApplyUserId());
            privilegeGrant.setGrantToObjType(GrantToObjType.USER);
            privilegeGrant.setGrantToType(Color.RED);
            privilegeGrant.setOperType(OperType.READ);
            privilegeGrant.setStatusCd("A");
            privilegeGrantService.save(privilegeGrant);
        }

        pendingApply.setStatusCd("X");
        privilegeGrantService.update(pendingApply);
        syncUserAuthToRedis(qo.getApplyUserId());
    }

    /**
     * 拒绝资源使用申请。
     * 处理规则：
     * 1. 当前操作人必须有资源管理权限；
     * 2. 将待审核申请记录置为已拒绝状态。
     * @author qin.guoquan
     * @date 2026-04-27 00:00:00
     */
    public void rejectUseApply(ResourceUseApplyApproveQo qo) {
        SsResource ssResource = getRequiredResource(qo.getResourceId());
        validateResourceUseApplyAuditAllowed(ssResource);
        validateResourceUseSettingPermission(ssResource);

        PrivilegeGrant pendingApply = getPendingUseApplyPrivilege(ssResource, qo.getApplyUserId());
        if (pendingApply == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.use.apply.notfound.or.processed"));
        }

        pendingApply.setStatusCd("R");
        privilegeGrantService.update(pendingApply);
    }

    /**
     * 根据资源和授权类型查询授权明细。 这里只负责从数据库拿“原始授权记录”，不在这一层做业务裁剪， 这样后续无论是统计、排查还是页面展示，都能复用同一份原始结果。
     */
    private List<ResourceMemberItemVo> queryResourceMemberRecords(SsResource ssResource, List<String> grantTypes) {
        return privilegeGrantService.queryResourceMembers(ssResource.getResourceId(), ssResource.getResourceBizType(),
            grantTypes);
    }

    /**
     * 查询资源，不存在时直接抛错。 资源类型从这里拿，避免前端传错类型，也让后续查询只依赖一个可信来源。
     */
    private SsResource getRequiredResource(Long resourceId) {
        SsResource ssResource = ssResourceMapper.selectById(resourceId);
        if (ssResource == null) {
            throw new BaseException(I18nUtil.get("resource.not.found"));
        }
        return ssResource;
    }

    /**
     * 根据资源业务类型回填扩展子表信息。 当前前端查看资源授权详情时，不只需要成员名单，也需要把不同资源类型的扩展配置一起带回去。 这里统一按主表 resourceBizType 分流查询对应子表，并转成 JSON 结构返回给前端。
     */
    private JSONObject buildResourceExtInfo(SsResource ssResource) {
        String resourceBizType = StringUtils.trimToEmpty(ssResource.getResourceBizType());
        Long resourceId = ssResource.getResourceId();

        if (StringUtils.equals(resourceBizType, "TOOL")) {
            return toJsonObject(ssResExtToolService.findById(resourceId));
        }
        if (StringUtils.equals(resourceBizType, "TOOLKIT")) {
            return toJsonObject(ssResExtToolKitService.findById(resourceId));
        }
        if (StringUtils.equals(resourceBizType, "MCP")) {
            return toJsonObject(ssResExtMcpService.findById(resourceId));
        }
        if (StringUtils.equals(resourceBizType, "AGENT")) {
            return toJsonObject(ssResExtAgentService.findById(resourceId));
        }
        if (StringUtils.equals(resourceBizType, "OBJECT")) {
            return toJsonObject(ssResExtObjectService.findById(resourceId));
        }
        if (StringUtils.equals(resourceBizType, "VIEW")) {
            return toJsonObject(ssResExtViewService.findById(resourceId));
        }
        if (StringUtils.containsIgnoreCase(resourceBizType, "DOC")) {
            return toJsonObject(ssResExtDocService.findById(resourceId));
        }

        return new JSONObject(true);
    }

    /**
     * 子表不存在时返回空对象，减少前端判空分支。
     */
    private JSONObject toJsonObject(Object extEntity) {
        if (extEntity == null) {
            return new JSONObject(true);
        }
        return JSON.parseObject(JSON.toJSONString(extEntity));
    }

    /**
     * 构造统一授权对象。 这里做三件事： 1. 用资源主表里的真实 resourceBizType 回填 grantObjType； 2. 对空名单做兜底，避免下游空指针； 3. 统一让后续流程都走 AuthRedBlackDTO
     * + handleAuth。
     */
    private AuthRedBlackDTO buildResourceMemberAuthDto(SsResource ssResource, String grantType,
        ResourceMemberSettingQo qo) {
        AuthRedBlackDTO authDto = new AuthRedBlackDTO();
        authDto.setGrantType(grantType);
        authDto.setGrantObjId(ssResource.getResourceId());
        authDto.setGrantObjType(ssResource.getResourceBizType());
        authDto.setOrgId(qo.getOrgId());
        authDto.setRedList(safeMemberList(qo.getRedList()));
        authDto.setBlackList(safeMemberList(qo.getBlackList()));
        return authDto;
    }

    /**
     * 对前端传入的名单做空值兜底。 这样前端即使不传 redList/blackList，也会被当作空集合处理， handleAuth 在比较历史权限时会自然把“页面上已移除”的成员清掉。
     */
    private List<AuthDTO> safeMemberList(List<AuthDTO> memberList) {
        return memberList == null ? Collections.emptyList() : memberList;
    }

    /**
     * 从授权记录中提取“当前有效”的红名单对象。 处理规则： 1. 先找出所有黑名单对象； 2. 再从红名单里剔除这些黑名单对象； 3. 对同一个授权对象的多条记录按 grantType 合并，避免重复返回。
     */
    private List<ResourceMemberItemVo> filterEffectiveRedMembers(List<ResourceMemberItemVo> records) {
        if (CollectionUtils.isEmpty(records)) {
            return Collections.emptyList();
        }
        Set<String> blackKeys = records.stream().filter(item -> Color.BLACK.equalsIgnoreCase(item.getGrantToType()))
            .map(this::buildMemberKey).collect(Collectors.toSet());

        List<ResourceMemberItemVo> redRecords = records.stream()
            .filter(
                item -> Color.RED.equalsIgnoreCase(item.getGrantToType()) && !blackKeys.contains(buildMemberKey(item)))
            .collect(Collectors.toList());
        return mergeMemberGrantTypes(redRecords);
    }

    /**
     * 提取黑名单对象列表。 黑名单本身不再做“红减黑”处理，而是按原始黑名单语义直接返回， 方便前端展示“哪些对象被显式排除了”。
     */
    private List<ResourceMemberItemVo> filterBlackMembers(List<ResourceMemberItemVo> records) {
        if (CollectionUtils.isEmpty(records)) {
            return Collections.emptyList();
        }
        List<ResourceMemberItemVo> blackRecords = records.stream()
            .filter(item -> Color.BLACK.equalsIgnoreCase(item.getGrantToType())).collect(Collectors.toList());
        return mergeMemberGrantTypes(blackRecords);
    }

    /**
     * 将同一授权对象的多条记录按 grantType 合并。 例如同一个用户可能同时有 AVAILABLE_USE 和 FORCE_USE 两条记录， 这里会把它们合并成一条，grantType 用逗号串联，减少前端去重成本。
     */
    private List<ResourceMemberItemVo> mergeMemberGrantTypes(List<ResourceMemberItemVo> records) {
        if (CollectionUtils.isEmpty(records)) {
            return Collections.emptyList();
        }
        Map<String, ResourceMemberItemVo> mergedMap = new LinkedHashMap<>();
        Map<String, LinkedHashSet<String>> grantTypeMap = new LinkedHashMap<>();
        for (ResourceMemberItemVo item : records) {
            String memberKey = buildMemberKey(item);
            mergedMap.computeIfAbsent(memberKey, key -> {
                ResourceMemberItemVo merged = new ResourceMemberItemVo();
                merged.setGrantToObjType(item.getGrantToObjType());
                merged.setGrantToObjId(item.getGrantToObjId());
                merged.setGrantToObjName(item.getGrantToObjName());
                merged.setGrantToType(item.getGrantToType());
                return merged;
            });
            grantTypeMap.computeIfAbsent(memberKey, key -> new LinkedHashSet<>()).add(item.getGrantType());
        }
        mergedMap.forEach((key, value) -> value.setGrantType(String.join(",", grantTypeMap.get(key))));
        return new ArrayList<>(mergedMap.values());
    }

    /**
     * 构造授权对象唯一键。 授权对象可能是 USER / ORG / POST / STATION， 因此需要“对象类型 + 对象ID”组合起来做唯一标识。
     */
    private String buildMemberKey(ResourceMemberItemVo memberVo) {
        return memberVo.getGrantToObjType() + "_" + memberVo.getGrantToObjId();
    }

    /**
     * 校验当前用户是否有权限维护某个资源的管理/使用名单。 当前放行规则： 1. 平台管理员； 2. 资源创建人； 3. 对该资源拥有有效 ALLOW_MANAGE 权限的人； 4. 资源归属组织的组织管理员。
     * 这里把校验逻辑统一收口，后续两个设置接口都复用这一套， 避免出现“管理人员设置有校验、使用人员设置没校验”的不一致问题。
     */
    private void validateResourceMemberSettingPermission(SsResource ssResource) {
        if (hasResourceMemberSettingPermission(ssResource)) {
            return;
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
    }

    /**
     * 校验当前用户是否可维护资源使用名单/审核使用申请。
     * 默认个人资源不允许管理授权，但当前用户绑定的默认个人资源允许维护使用授权。
     */
    private void validateResourceUseSettingPermission(SsResource ssResource) {
        if (hasResourceUseSettingPermission(ssResource)) {
            return;
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
    }

    /**
     * 默认超级助手是用户登录自动初始化的个人底座资源，不允许被授权给其他人使用。
     * 这里放在后端入口兜底，避免只依赖前端隐藏按钮导致接口被绕过。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     * @param ssResource 资源
     */
    private void validateDefaultSuperAssistantUseAuthAllowed(SsResource ssResource) {
        if (!isDefaultSuperAssistantResource(ssResource)) {
            return;
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
    }

    /**
     * 判断当前用户是否具备资源成员设置权限。
     */
    private boolean hasResourceMemberSettingPermission(SsResource ssResource) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        // 平台管理员拥有全局操作权限。
        if (CurrentUserHolder.isPlatformManager()) {
            return true;
        }

        // 资源创建人可以维护自己的资源成员。
        if (currentUserId != null && currentUserId.equals(ssResource.getCreateBy())) {
            return true;
        }

        // 资源归属组织的组织管理员可以维护该组织下资源。
        if (ssResource.getManOrgId() != null
            && organizationService.isOrganizationManManager(ssResource.getManOrgId())) {
            return true;
        }

        // 对资源有有效管理权限的人，同样允许维护资源成员。
        return hasEffectiveAllowManagePrivilege(ssResource, currentUserId);
    }

    /**
     * 判断当前登录用户是否具备指定资源的管理权限。
     * 该能力可供导入更新、资源维护等场景复用，统一管理权限判定口径。
     * @author qin.guoquan
     * @date 2026-04-24 18:08:00
     */
    public boolean hasResourceManagePermission(SsResource ssResource) {
        if (ssResource == null) {
            return false;
        }
        return hasResourceMemberSettingPermission(ssResource);
    }

    /**
     * 判断当前登录用户是否被显式授予资源管理权限。
     * 该方法只看 ALLOW_MANAGE 授权，不叠加平台管理员/组织管理员等管理兜底能力，
     * 适用于“左侧列表可见即可设为默认”等需要与授权列表保持一致的场景。
     */
    public boolean hasCurrentUserAllowManagePrivilege(SsResource ssResource) {
        if (ssResource == null) {
            return false;
        }
        return hasEffectiveAllowManagePrivilege(ssResource, CurrentUserHolder.getCurrentUserId());
    }

    /**
     * 判断当前登录用户是否具备资源使用授权维护权限。
     */
    public boolean hasResourceUseSettingPermission(SsResource ssResource) {
        if (ssResource == null) {
            return false;
        }
        return hasResourceMemberSettingPermission(ssResource) || isCurrentUserBoundDefaultPersonalResource(ssResource);
    }

    private boolean isCurrentUserBoundDefaultPersonalResource(SsResource ssResource) {
        if (ssResource == null || !StringUtils.equals(ssResource.getOwnerType(), OwnerType.PERSONAL_DEFAULT)) {
            return false;
        }
        if (CurrentUserHolder.getLoginInfo() == null || ssResource.getResourceId() == null) {
            return false;
        }
        Long sessionDatasetId = CurrentUserHolder.getSessionDatasetId();
        Long defaultDigEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        return ssResource.getResourceId().equals(sessionDatasetId)
            || ssResource.getResourceId().equals(defaultDigEmployeeId);
    }

    /**
     * 校验当前用户是否可以发起资源使用申请。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    private void validateCurrentUserCanApplyUse(SsResource ssResource, Long currentUserId) {
        Long resourceId = ssResource.getResourceId();
        List<Long> resourceIds = List.of(resourceId);
        List<String> resourceBizTypes = List.of(ssResource.getResourceBizType());
        if (ssResource.getPublishPortal() != null && ssResource.getPublishPortal() == 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("resource.not.allow.auth", ssResource.getResourceName()));
        }
        if (currentUserId.equals(ssResource.getCreateBy())) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.use.apply.already.authorized"));
        }
        if (queryCurrentUserUseBlacklistedResourceIds(resourceIds, resourceBizTypes).contains(resourceId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.use.apply.blacklisted"));
        }
        if (queryCurrentUserUsePermittedResourceIds(resourceIds, resourceBizTypes).contains(resourceId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.use.apply.already.authorized"));
        }
        if (queryCurrentUserPendingUseApplyResourceIds(resourceIds, resourceBizTypes).contains(resourceId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.use.apply.duplicate"));
        }
    }

    /**
     * 判断当前用户是否命中资源使用黑名单。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    private boolean isCurrentUserUseBlacklisted(SsResource ssResource, Long currentUserId) {
        return getActiveUserPrivilege(ssResource, currentUserId, GrantType.AVAILABLE_USE, Color.BLACK, "A") != null
            || getActiveUserPrivilege(ssResource, currentUserId, GrantType.FORCE_USE, Color.BLACK, "A") != null;
    }

    /**
     * 查询指定用户在资源上的单条授权记录。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    private PrivilegeGrant getActiveUserPrivilege(SsResource ssResource, Long userId, String grantType, String color,
        String statusCd) {
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantObjId, ssResource.getResourceId());
        queryWrapper.eq(PrivilegeGrant::getGrantObjType, ssResource.getResourceBizType());
        queryWrapper.eq(PrivilegeGrant::getGrantType, grantType);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.USER);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjId, userId);
        queryWrapper.eq(PrivilegeGrant::getGrantToType, color);
        queryWrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, statusCd);
        queryWrapper.last("limit 1");
        return privilegeGrantMapper.selectOne(queryWrapper);
    }

    /**
     * 查询资源待审核申请列表。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    private List<PrivilegeGrant> listPendingUseApplyPrivileges(SsResource ssResource) {
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantObjId, ssResource.getResourceId());
        queryWrapper.eq(PrivilegeGrant::getGrantObjType, ssResource.getResourceBizType());
        queryWrapper.eq(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.USER);
        queryWrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        queryWrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, USE_APPLY_PENDING_STATUS);
        queryWrapper.orderByDesc(PrivilegeGrant::getCreateDate);
        return privilegeGrantMapper.selectList(queryWrapper);
    }

    /**
     * 查询某个用户的待审核申请记录。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    private PrivilegeGrant getPendingUseApplyPrivilege(SsResource ssResource, Long userId) {
        return getActiveUserPrivilege(ssResource, userId, GrantType.AVAILABLE_USE, Color.RED,
            USE_APPLY_PENDING_STATUS);
    }

    /**
     * 获取用户展示名称。
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    private String getUserDisplayName(Users user) {
        if (user == null) {
            return "-";
        }
        if (StringUtils.isNotBlank(user.getUserName())) {
            return user.getUserName();
        }
        if (StringUtils.isNotBlank(user.getUserCode())) {
            return user.getUserCode();
        }
        return String.valueOf(user.getUserId());
    }

    /**
     * 查询资源中心固定入口按钮能力。
     * 企业知识/工具/视图/对象导入入口仅对平台管理员、组织管理员、业务管理员开放。
     *
     * @author qin.guoquan
     * @date 2026-04-24 19:08:00
     */
    public FixedEntryOperationCapabilityVo queryFixedEntryOperationCapability() {
        FixedEntryOperationCapabilityVo capabilityVo = new FixedEntryOperationCapabilityVo();
        boolean hasEnterpriseImportPermission = CurrentUserHolder.isPlatformManager()
            || CurrentUserHolder.isOrganizationAdmin()
            || CurrentUserHolder.isBusinessAdmin();
        capabilityVo.setCanImportEnterpriseKg(hasEnterpriseImportPermission);
        capabilityVo.setCanImportEnterpriseToolkit(hasEnterpriseImportPermission);
        capabilityVo.setCanImportEnterpriseView(hasEnterpriseImportPermission);
        capabilityVo.setCanImportEnterpriseObject(hasEnterpriseImportPermission);
        return capabilityVo;
    }

    /**
     * 查询当前登录用户在指定资源集合中被命中的使用黑名单资源。
     * 该方法会复用现有 listAuthPrivilegeGrant(...) 逻辑，把用户本人、所属组织、岗位、驻地的 AVAILABLE_USE/FORCE_USE 授权一并拉取，
     * 然后在当前页资源范围内判断是否存在有效 BLACK 记录。
     * @author qin.guoquan
     * @date 2026-04-25 10:18:00
     */
    public Set<Long> queryCurrentUserUseBlacklistedResourceIds(Collection<Long> resourceIds,
        Collection<String> resourceBizTypes) {
        if (CollectionUtils.isEmpty(resourceIds) || CollectionUtils.isEmpty(resourceBizTypes)
            || CurrentUserHolder.getCurrentUserId() == null) {
            return Collections.emptySet();
        }
        List<PrivilegeGrant> privilegeGrants = listAuthPrivilegeGrant(null, new ArrayList<>(resourceBizTypes),
            GrantToObjType.USER, CurrentUserHolder.getCurrentUserId(),
            List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE));
        if (CollectionUtils.isEmpty(privilegeGrants)) {
            return Collections.emptySet();
        }
        Set<Long> resourceIdSet = new HashSet<>(resourceIds);
        return privilegeGrants.stream()
            .filter(item -> item.getGrantObjId() != null && resourceIdSet.contains(item.getGrantObjId()))
            .filter(item -> Color.BLACK.equalsIgnoreCase(item.getGrantToType()) && "A".equalsIgnoreCase(item.getStatusCd()))
            .map(PrivilegeGrant::getGrantObjId)
            .collect(Collectors.toSet());
    }

    /**
     * 查询当前用户已持有使用权限的资源ID集合。
     * 复用 listAuthPrivilegeGrant 拉取当前用户 USER 维度的 AVAILABLE_USE/FORCE_USE 授权，
     * 筛选有效 RED（红名单）记录，返回对应的资源ID集合。
     */
    public Set<Long> queryCurrentUserUsePermittedResourceIds(Collection<Long> resourceIds,
        Collection<String> resourceBizTypes) {
        if (CollectionUtils.isEmpty(resourceIds) || CollectionUtils.isEmpty(resourceBizTypes)
            || CurrentUserHolder.getCurrentUserId() == null) {
            return Collections.emptySet();
        }
        List<PrivilegeGrant> privilegeGrants = listAuthPrivilegeGrant(null, new ArrayList<>(resourceBizTypes),
            GrantToObjType.USER, CurrentUserHolder.getCurrentUserId(),
            List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE));
        if (CollectionUtils.isEmpty(privilegeGrants)) {
            return Collections.emptySet();
        }
        Set<Long> resourceIdSet = new HashSet<>(resourceIds);
        return privilegeGrants.stream()
            .filter(item -> item.getGrantObjId() != null && resourceIdSet.contains(item.getGrantObjId()))
            .filter(item -> Color.RED.equalsIgnoreCase(item.getGrantToType()) && "A".equalsIgnoreCase(item.getStatusCd()))
            .map(PrivilegeGrant::getGrantObjId)
            .collect(Collectors.toSet());
    }

    /**
     * 查询当前用户已经提交、仍在待审核中的使用申请资源ID集合。
     */
    public Set<Long> queryCurrentUserPendingUseApplyResourceIds(Collection<Long> resourceIds,
        Collection<String> resourceBizTypes) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (CollectionUtils.isEmpty(resourceIds) || CollectionUtils.isEmpty(resourceBizTypes) || currentUserId == null) {
            return Collections.emptySet();
        }
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(PrivilegeGrant::getGrantObjId, resourceIds);
        queryWrapper.in(PrivilegeGrant::getGrantObjType, resourceBizTypes);
        queryWrapper.eq(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.USER);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjId, currentUserId);
        queryWrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        queryWrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, USE_APPLY_PENDING_STATUS);
        return privilegeGrantMapper.selectList(queryWrapper).stream()
            .map(PrivilegeGrant::getGrantObjId)
            .filter(java.util.Objects::nonNull)
            .collect(Collectors.toSet());
    }

    /**
     * 判断当前用户是否对指定资源拥有有效的 ALLOW_MANAGE 权限。 这里复用现有 listAuthPrivilegeGrant(...) 能力，把用户本人、所属组织、岗位、驻地
     * 的授权都拉出来，再对当前资源做一次“红减黑”判断。
     */
    private boolean hasEffectiveAllowManagePrivilege(SsResource ssResource, Long currentUserId) {
        if (currentUserId == null) {
            return false;
        }

        List<PrivilegeGrant> privilegeGrants = listAuthPrivilegeGrant(GrantType.ALLOW_MANAGE,
            List.of(ssResource.getResourceBizType()), GrantToObjType.USER, currentUserId, null);
        if (CollectionUtils.isEmpty(privilegeGrants)) {
            return false;
        }

        List<PrivilegeGrant> currentResourceGrants = privilegeGrants.stream()
            .filter(item -> ssResource.getResourceId().equals(item.getGrantObjId())).collect(Collectors.toList());
        if (CollectionUtils.isEmpty(currentResourceGrants)) {
            return false;
        }

        boolean hasRedGrant = currentResourceGrants.stream().anyMatch(
            item -> Color.RED.equalsIgnoreCase(item.getGrantToType()) && "A".equalsIgnoreCase(item.getStatusCd()));
        boolean hasBlackGrant = currentResourceGrants.stream().anyMatch(
            item -> Color.BLACK.equalsIgnoreCase(item.getGrantToType()) && "A".equalsIgnoreCase(item.getStatusCd()));
        return hasRedGrant && !hasBlackGrant;
    }

    /**
     * 批量同步用户权限到Redis（异步执行，不阻塞主流程）
     *
     * @param userIds 用户标识集合
     */
    @Async
    public void syncUsersAuthToRedis(Collection<Long> userIds) {
        if (CollectionUtils.isEmpty(userIds)) {
            return;
        }

        int batchSize = 100;
        List<Long> userIdList = new ArrayList<>(userIds);
        int total = userIdList.size();
        int successCount = 0;
        int failCount = 0;

        for (int i = 0; i < userIdList.size(); i += batchSize) {
            List<Long> batch = userIdList.subList(i, Math.min(i + batchSize, userIdList.size()));
            for (Long userId : batch) {
                try {
                    Map<String, String> resourceAuthMap = buildUserAuthResources(userId);
                    authRedisApplicationService.writeUserAuth(userId, resourceAuthMap);
                    successCount++;
                }
                catch (Exception e) {
                    failCount++;
                    logger.error("同步用户{}权限到Redis失败：{}", userId, e.getMessage());
                }
            }
            logger.info("批量同步用户权限到Redis进度：{}/{}", Math.min(i + batchSize, total), total);
        }

        logger.info("批量同步用户权限到Redis完成，总数：{}，成功：{}，失败：{}", total, successCount, failCount);
    }

    /**
     * 从授权变更中提取涉及的用户ID集合 处理USER/ORG/POST三种授权对象类型
     *
     * @param compareVo 授权变更对比结果
     * @param grantObjType 资源类型（grantObjType，即被授权的资源是什么类型，如AGENT）
     * @param grantObjId 资源标识（grantObjId，即被授权的资源的ID）
     * @return 涉及的用户ID集合
     */
    private Set<Long> extractInvolvedUserIds(CompareVo compareVo, String grantObjType, Long grantObjId) {
        Set<Long> userIds = new HashSet<>();

        // 从compareVo中提取所有涉及的grantToObjType和grantToObjId
        Set<Long> orgIds = new HashSet<>();
        Set<Long> postIds = new HashSet<>();
        Set<Long> stationIds = new HashSet<>();

        // 提取红名单新增/更新中的授权对象
        extractGrantToInfo(compareVo.getRedAddMap(), userIds, orgIds, postIds, stationIds);
        extractGrantToInfo(compareVo.getRedUpdateMap(), userIds, orgIds, postIds, stationIds);
        // 红名单删除的也需要处理（因为可能影响权限）
        extractGrantToInfo(compareVo.getRedDelMap(), userIds, orgIds, postIds, stationIds);

        // 提取黑名单新增/更新中的授权对象
        extractGrantToInfo(compareVo.getBlackAddMap(), userIds, orgIds, postIds, stationIds);
        extractGrantToInfo(compareVo.getBlackUpdateMap(), userIds, orgIds, postIds, stationIds);
        // 黑名单删除的也需要处理（因为可能影响权限）
        extractGrantToInfo(compareVo.getBlackDelMap(), userIds, orgIds, postIds, stationIds);

        // 如果有授权给组织，查询组织下的所有用户
        if (CollectionUtils.isNotEmpty(orgIds)) {
            try {
                for (Long orgId : orgIds) {
                    List<Long> orgUserIds = userService.findUserIdsByOrgId(orgId);
                    if (CollectionUtils.isNotEmpty(orgUserIds)) {
                        userIds.addAll(orgUserIds);
                    }
                }
            }
            catch (Exception e) {
                logger.error("查询组织下用户失败：{}", e.getMessage());
            }
        }

        // 如果有授权给岗位，查询岗位下的所有用户
        if (CollectionUtils.isNotEmpty(postIds)) {
            try {
                for (Long postId : postIds) {
                    List<Long> postUserIds = usersMapper.findUserIdsByPostId(postId);
                    if (CollectionUtils.isNotEmpty(postUserIds)) {
                        userIds.addAll(postUserIds);
                    }
                }
            }
            catch (Exception e) {
                logger.error("查询岗位下用户失败：{}", e.getMessage());
            }
        }

        // 如果有授权给驻地，查询驻地下的所有用户
        if (CollectionUtils.isNotEmpty(stationIds)) {
            try {
                for (Long stationId : stationIds) {
                    List<Long> stationUserIds = usersMapper.findUserIdsByStationId(stationId);
                    if (CollectionUtils.isNotEmpty(stationUserIds)) {
                        userIds.addAll(stationUserIds);
                    }
                }
            }
            catch (Exception e) {
                logger.error("查询驻地下用户失败：{}", e.getMessage());
            }
        }

        return userIds;
    }

    /**
     * 从PrivilegeGrant中提取授权对象信息
     */
    private void extractGrantToInfo(Map<String, PrivilegeGrant> grantMap, Set<Long> userIds, Set<Long> orgIds,
        Set<Long> postIds, Set<Long> stationIds) {
        if (MapUtils.isEmpty(grantMap)) {
            return;
        }

        for (PrivilegeGrant grant : grantMap.values()) {
            if (grant == null) {
                continue;
            }

            String grantToObjType = grant.getGrantToObjType();
            Long grantToObjId = grant.getGrantToObjId();

            if (grantToObjId == null) {
                continue;
            }

            if (GrantToObjType.USER.equalsIgnoreCase(grantToObjType)) {
                userIds.add(grantToObjId);
            }
            else if (GrantToObjType.ORG.equalsIgnoreCase(grantToObjType)) {
                orgIds.add(grantToObjId);
            }
            else if (GrantToObjType.POST.equalsIgnoreCase(grantToObjType)) {
                postIds.add(grantToObjId);
            }
            else if (GrantToObjType.STATION.equalsIgnoreCase(grantToObjType)) {
                stationIds.add(grantToObjId);
            }
        }
    }

    @Autowired
    private UsersMapper usersMapper;

    public Set<Long> getCurrentUserPrivList(PrivilegeGrantQo qo) {

        List<PrivilegeGrant> authList = listAuthPrivilegeGrant(qo.getGrantType(), qo.getGrantObjTypes(),
            qo.getGrantToObjType(), qo.getGrantToObjId(), qo.getGrantTypes());
        // 过滤掉黑名单资源
        return filterBackList(authList);
    }

    /**
     * 过滤权限列表中的黑名单资�?
     *
     * @param authList 权限授权列表，包含资源授权信�?
     * @return 过滤后的有效资源ID集合，不包含黑名单资�?
     */
    public Set<Long> filterBackList(List<PrivilegeGrant> authList) {
        if (authList == null || authList.isEmpty()) {
            return Collections.emptySet();
        }

        // 按资源ID分组处理权限
        Map<Long, List<PrivilegeGrant>> authByResource = authList.stream().filter(item -> null != item.getGrantObjId())
            .collect(Collectors.groupingBy(PrivilegeGrant::getGrantObjId));

        // 过滤掉黑名单中的资源
        return authByResource.entrySet().stream().filter(entry -> {
            List<PrivilegeGrant> resourceAuths = entry.getValue();
            // 检查是否有红名单权�?
            boolean hasRedAuth = resourceAuths.stream().anyMatch(auth -> Color.RED.equals(auth.getGrantToType()));

            // 检查是否有黑名单权�?
            boolean hasBlackAuth = resourceAuths.stream().anyMatch(auth -> Color.BLACK.equals(auth.getGrantToType()));

            // 黑名单优先级更高：有红名单且无黑名单才有权限
            return hasRedAuth && !hasBlackAuth;
        }).map(Map.Entry::getKey).collect(Collectors.toSet());
    }

    /**
     * 查询授权对象
     */
    // * @param grantType 授权范围
    // * @param grantObjTypes 资源类型,AGENT:智能体DOC:文档DB:数据库PLUGIN:插件,TOOL:工具,CATLOGUE:文档库目录TAG:标签
    // * @param grantToObjType 授权对象类型,USER:人员,ORG:组织,POST:岗位
    // * @param grantToObjId 授权对象标识
    // * @return List<PrivilegeGrant>
    public List<PrivilegeGrant> listAuthPrivilegeGrant(String grantType, List<String> grantObjTypes,
        String grantToObjType, Long grantToObjId, List<String> grantTypes) {

        // 查询授权信息
        PrivilegeGrantQo privilegeGrantQo = new PrivilegeGrantQo();
        // 如果为空，设置grantType,否则设置GrantTypes
        if (CollectionUtils.isNotEmpty(grantTypes)) {
            privilegeGrantQo.setGrantTypes(grantTypes);
        }
        else {
            privilegeGrantQo.setGrantType(grantType);
        }
        privilegeGrantQo.setGrantObjTypes(grantObjTypes);
        privilegeGrantQo.setGrantToObjType(grantToObjType);
        privilegeGrantQo.setGrantToObjId(grantToObjId);
        List<PrivilegeGrant> authPrivilegeGrantList = privilegeGrantService.findPrivilegeByQo(privilegeGrantQo);

        // 如果是用户类型授权，还要查询用户所在的组织和岗位授权信息
        if (GrantToObjType.USER.equalsIgnoreCase(grantToObjType)) {

            // 添加用户组织授权信息
            List<Organization> organizationList = organizationService.findOrganizationByUserId(grantToObjId);

            // 用户所在组织的上下级关系，也一并查询
            Set<Long> orgIdList = new HashSet<>(100);
            for (Organization organization : organizationList) {
                String pathCode = organization.getPathCode();
                if (StringUtil.isEmpty(pathCode)) {
                    continue;
                }
                for (String orgIdStr : pathCode.split("\\.")) {
                    orgIdList.add(Long.parseLong(orgIdStr));
                }
            }

            PrivilegeGrantQo organizationGrantQo = new PrivilegeGrantQo();
            organizationGrantQo.setGrantType(grantType);
            organizationGrantQo.setGrantObjTypes(grantObjTypes);
            organizationGrantQo.setGrantToObjType(GrantToObjType.ORG);
            organizationGrantQo.setGrantToObjIds(orgIdList);
            organizationGrantQo.setGrantTypes(grantTypes);
            List<PrivilegeGrant> organizationGrantList = privilegeGrantService.findPrivilegeByQo(organizationGrantQo);
            authPrivilegeGrantList.addAll(organizationGrantList);

            // 添加用户岗位授权信息
            List<PositionDTO> positionList = positionService.findPositionByUserId(grantToObjId);
            PrivilegeGrantQo positionGrantQo = new PrivilegeGrantQo();
            positionGrantQo.setGrantType(grantType);
            positionGrantQo.setGrantObjTypes(grantObjTypes);
            positionGrantQo.setGrantToObjType(GrantToObjType.POST);
            positionGrantQo.setGrantTypes(grantTypes);
            positionGrantQo
                .setGrantToObjIds(positionList.stream().map(PositionDTO::getPositionId).collect(Collectors.toList()));
            List<PrivilegeGrant> positionGrantList = privilegeGrantService.findPrivilegeByQo(positionGrantQo);
            authPrivilegeGrantList.addAll(positionGrantList);

            // 添加用户驻地授权信息
            Station station = stationService.getStationByUserId(grantToObjId);
            if (null != station && StringUtil.isNotEmpty(station.getStationIdPath())) {
                UserStation userStation = new UserStation();
                BeanUtils.copyProperties(station, userStation);
                List<Long> stationIds = CompletionsUtils.getStationIds(userStation);
                PrivilegeGrantQo stationGrantQo = new PrivilegeGrantQo();
                stationGrantQo.setGrantType(grantType);
                stationGrantQo.setGrantObjTypes(grantObjTypes);
                stationGrantQo.setGrantToObjType(GrantToObjType.STATION);
                stationGrantQo.setGrantToObjIds(stationIds);
                stationGrantQo.setGrantTypes(grantTypes);
                List<PrivilegeGrant> stationGrantList = privilegeGrantService.findPrivilegeByQo(stationGrantQo);
                authPrivilegeGrantList.addAll(stationGrantList);
            }

        }

        return authPrivilegeGrantList;
    }

    // checkPermission() 和 buildAuthMap() 已迁移到ResourceAuthApplicationService
    // buildQueryParam() 已删除（未使用）

    /**
     * 注意：以下方法已迁移到ResourceAuthApplicationService，以避免循环依赖：- listResourceAuth() - listDigitalEmployeeAuth() -
     * listOwnEmployee() - listOwnResource() - listResource() 以及相关辅助方法：- buildAuthMap() - 保留但改为public供外部调用-
     * checkPermission() - 已迁移- getQueryMap() - 已迁移- buildResourceAuthVo() - 已迁移- buildDigitalAuthVo() - 已迁移-
     * buildOwnAuthQo() - 已迁移- getOwnEmployeeIdList() - 已迁移- getAuthType() - 已迁移
     */

    /***
     * 处理授权
     *
     * @param authRedBlackDTO 授权对象
     */
    public void handleAuth(AuthRedBlackDTO authRedBlackDTO) {

        String grantType = authRedBlackDTO.getGrantType();
        String grantObjType = authRedBlackDTO.getGrantObjType();
        Long grantObjId = authRedBlackDTO.getGrantObjId();
        if (GrantType.ALLOW_MANAGE.equals(grantType)) {
            validateResourceManageAuthAllowed(getRequiredResource(grantObjId));
        }
        // 未勾选，默认为02，不允许退订
        String allowSubscribe = authRedBlackDTO.isAllowUnSubscribe() ? Constants.ALLOW_UNSUBSCRIBE
            : Constants.NOT_ALLOW_UNSUBSCRIBE;
        CompareVo compareVo = new CompareVo();
        // 红名单授权
        List<AuthDTO> redList = authRedBlackDTO.getRedList();

        if (ListUtil.isNotEmpty(redList)) {

            List<PrivilegeGrant> redGrantList = this.buildAuth(grantType, grantObjType, grantObjId, redList, Color.RED,
                allowSubscribe);

            List<PrivilegeGrant> historyRedList = privilegeGrantService.findPrivilegeGrant(grantType, grantObjType,
                grantObjId, Color.RED);

            // 红名单对比处理红名单
            this.comparePrivilegeGrant(grantType, redGrantList, historyRedList, Color.RED, compareVo);

        }
        else {
            // 取消所有红名单授权
            List<PrivilegeGrant> historyRedList = privilegeGrantService.findPrivilegeGrant(grantType, grantObjType,
                grantObjId, Color.RED);

            Map<String, PrivilegeGrant> removePrivilegeGrantMap = this.buildPrivilegeGrantMap(historyRedList);
            compareVo.getRedDelMap().putAll(removePrivilegeGrantMap);

        }

        // 处理黑名单授权
        List<AuthDTO> blackList = authRedBlackDTO.getBlackList();
        if (ListUtil.isNotEmpty(blackList)) {

            List<PrivilegeGrant> blackGrantList = this.buildAuth(grantType, grantObjType, grantObjId, blackList,
                Color.BLACK, allowSubscribe);

            List<PrivilegeGrant> historyRedList = privilegeGrantService.findPrivilegeGrant(grantType, grantObjType,
                grantObjId, Color.BLACK);

            // 黑名单对比处理
            this.comparePrivilegeGrant(grantType, blackGrantList, historyRedList, Color.BLACK, compareVo);

        }
        else {

            // 查询原始数据黑名单删除
            List<PrivilegeGrant> historyBlackList = privilegeGrantService.findPrivilegeGrant(grantType, grantObjType,
                grantObjId, Color.BLACK);

            // 黑名单删除
            Map<String, PrivilegeGrant> removePrivilegeGrantMap = this.buildPrivilegeGrantMap(historyBlackList);
            compareVo.getBlackDelMap().putAll(removePrivilegeGrantMap);

        }

        logger.info("当前权限对比结果：{}", JSON.toJSONString(compareVo));

        // 处理红名单
        this.handleAdd(grantType, compareVo.getRedAddMap());
        this.handleUpdate(grantType, compareVo.getRedUpdateMap());
        this.handleDel(grantType, compareVo.getRedDelMap());

        // 处理黑名单
        this.handleAdd(grantType, compareVo.getBlackAddMap());
        this.handleUpdate(grantType, compareVo.getBlackUpdateMap());
        this.handleDel(grantType, compareVo.getBlackDelMap());

        if (GrantType.SHARE_USE.equalsIgnoreCase(grantType)) {
            // grantObjId为文档库objId
            this.writeRedisForShareUse(compareVo, grantObjId);
        }

        if (GrantType.ALLOW_MANAGE.equals(grantType)) {
            this.ensureUsePrivilegeForAllowManageTargets(authRedBlackDTO);
        }

        // 同步涉及用户的权限到Redis
        // 授权变更后，为所有涉及的用户重新构建权限缓存
        try {
            Set<Long> involvedUserIds = this.extractInvolvedUserIds(compareVo, grantObjType, grantObjId);
            if (CollectionUtils.isNotEmpty(involvedUserIds)) {
                logger.info("授权变更涉及用户数：{}，开始同步权限到Redis", involvedUserIds.size());
                this.authRedisSyncService.asyncSyncAuthChangedUsers(involvedUserIds, grantType);
            }
        }
        catch (Exception e) {
            logger.error("同步用户权限到Redis失败：{}", e.getMessage());
        }
    }

    /**
     * 管理权限隐含使用能力：当资源管理红名单新增/保留 USER/ORG/POST/STATION 维度对象时，自动补齐同维度 FORCE_USE。
     * 如果同维度已经在使用黑名单中，说明业务明确禁止其使用，此时只保留管理权限，不自动覆盖黑名单。
     * 取消管理权限不会触发使用权限删除，避免误删用户已有的直接使用授权。
     */
    private void ensureUsePrivilegeForAllowManageTargets(AuthRedBlackDTO authRedBlackDTO) {
        List<AuthDTO> inheritTargets = extractManageUseInheritTargets(authRedBlackDTO);
        if (CollectionUtils.isEmpty(inheritTargets)) {
            return;
        }
        List<AuthDTO> forceUseTargets = inheritTargets.stream()
            .filter(target -> !hasActiveUseBlackSameDimension(authRedBlackDTO.getGrantObjType(),
                authRedBlackDTO.getGrantObjId(), target.getGrantToObjType(), target.getGrantToObjId()))
            .collect(Collectors.toList());
        if (CollectionUtils.isEmpty(forceUseTargets)) {
            return;
        }
        AuthRedBlackDTO useAuthDto = new AuthRedBlackDTO();
        useAuthDto.setGrantObjId(authRedBlackDTO.getGrantObjId());
        useAuthDto.setGrantObjType(authRedBlackDTO.getGrantObjType());
        useAuthDto.setGrantType(GrantType.FORCE_USE);
        useAuthDto.setSourceSystem(authRedBlackDTO.getSourceSystem());
        useAuthDto.setAllowUnSubscribe(authRedBlackDTO.isAllowUnSubscribe());
        useAuthDto.setOrgId(authRedBlackDTO.getOrgId());
        useAuthDto.setRedList(forceUseTargets);
        handleAuth(useAuthDto);
    }

    /**
     * 提取本次管理红名单中需要继承使用权限的授权对象；若同维度同时出现在管理黑名单中，则不参与补使用权限。
     */
    private List<AuthDTO> extractManageUseInheritTargets(AuthRedBlackDTO authRedBlackDTO) {
        if (authRedBlackDTO == null || CollectionUtils.isEmpty(authRedBlackDTO.getRedList())) {
            return Collections.emptyList();
        }
        Set<String> manageBlackKeys = buildGrantTargetKeys(authRedBlackDTO.getBlackList());
        Map<String, AuthDTO> targetMap = new LinkedHashMap<>();
        for (AuthDTO authDTO : authRedBlackDTO.getRedList()) {
            if (!isManageUseInheritTarget(authDTO)) {
                continue;
            }
            String targetKey = buildGrantTargetKey(authDTO);
            if (manageBlackKeys.contains(targetKey)) {
                continue;
            }
            targetMap.putIfAbsent(targetKey, authDTO);
        }
        return new ArrayList<>(targetMap.values());
    }

    private Set<String> buildGrantTargetKeys(List<AuthDTO> authList) {
        if (CollectionUtils.isEmpty(authList)) {
            return Collections.emptySet();
        }
        return authList.stream()
            .filter(this::isManageUseInheritTarget)
            .map(this::buildGrantTargetKey)
            .collect(Collectors.toSet());
    }

    private boolean isManageUseInheritTarget(AuthDTO authDTO) {
        return authDTO != null
            && authDTO.getGrantToObjId() != null
            && MANAGE_USE_INHERIT_TARGET_TYPES.contains(authDTO.getGrantToObjType());
    }

    private String buildGrantTargetKey(AuthDTO authDTO) {
        return authDTO.getGrantToObjType() + "_" + authDTO.getGrantToObjId();
    }

    /**
     * 同资源、同授权维度已有使用黑名单时，不自动补 FORCE_USE，保持“显式禁止使用”的优先级。
     */
    private boolean hasActiveUseBlackSameDimension(String grantObjType, Long grantObjId, String grantToObjType,
        Long grantToObjId) {
        if (StringUtils.isBlank(grantObjType) || grantObjId == null || StringUtils.isBlank(grantToObjType)
            || grantToObjId == null) {
            return false;
        }
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantObjType, grantObjType);
        queryWrapper.eq(PrivilegeGrant::getGrantObjId, grantObjId);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjType, grantToObjType);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjId, grantToObjId);
        queryWrapper.eq(PrivilegeGrant::getGrantToType, Color.BLACK);
        queryWrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, "A");
        queryWrapper.in(PrivilegeGrant::getGrantType, GrantType.AVAILABLE_USE, GrantType.FORCE_USE);
        return privilegeGrantMapper.selectCount(queryWrapper) > 0;
    }

    /**
     * 资源创建成功后，为创建人补齐默认管理授权和强制使用授权。
     *
     * @param ssResource 已创建的资源主表记录
     * @author qin.guoquan
     * @date 2026-05-07 164200
     */
    public void ensureCreatorDefaultPrivileges(SsResource ssResource) {
        if (ssResource == null || ssResource.getResourceId() == null) {
            return;
        }
        Long creatorUserId = ssResource.getCreateBy();
        if (creatorUserId == null) {
            creatorUserId = CurrentUserHolder.getCurrentUserId();
        }
        if (creatorUserId == null) {
            return;
        }
        // 个人助理不开放管理授权，因此创建时只补使用授权，避免保存后被管理授权校验反向拦截。
        // 其他资源导入同一资源编码时会复用已有资源主表，补默认授权前按“同资源+同授权对象+同权限族”做幂等。
        if (shouldEnsureCreatorManagePrivilege(ssResource)
            && !hasCreatorSameDimensionGrant(ssResource, creatorUserId, List.of(GrantType.ALLOW_MANAGE))) {
            handleAuth(buildCreatorUserPrivilegeDto(ssResource, creatorUserId, GrantType.ALLOW_MANAGE));
        }
        if (!hasCreatorSameDimensionGrant(ssResource, creatorUserId, List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE))) {
            handleAuth(buildCreatorUserPrivilegeDto(ssResource, creatorUserId, GrantType.FORCE_USE));
        }
    }

    /**
     * 判断创建人在同一授权维度下是否已经持有指定权限族。
     */
    private boolean hasCreatorSameDimensionGrant(SsResource ssResource, Long creatorUserId, List<String> grantTypes) {
        if (ssResource == null || creatorUserId == null || CollectionUtils.isEmpty(grantTypes)) {
            return false;
        }
        return hasSameDimensionPermissionFamily(ssResource.getResourceBizType(), ssResource.getResourceId(),
            GrantToObjType.USER, creatorUserId, grantTypes);
    }

    /**
     * 默认个人资源和个人助理不补创建人管理授权；这类资源只能由本人使用，不支持对外管理授权。
     */
    private boolean shouldEnsureCreatorManagePrivilege(SsResource ssResource) {
        return ssResource != null
            && !StringUtils.equals(ssResource.getOwnerType(), OwnerType.PERSONAL_DEFAULT)
            && !isPersonalAssistantResource(ssResource);
    }

    /**
     * 构建创建人用户维度的默认授权 DTO。
     *
     * @param ssResource 资源主表记录
     * @param creatorUserId 创建人用户ID
     * @param grantType 授权类型
     * @return 创建人红名单授权 DTO
     * @author qin.guoquan
     * @date 2026-05-07 164900
     */
    private AuthRedBlackDTO buildCreatorUserPrivilegeDto(SsResource ssResource, Long creatorUserId, String grantType) {
        AuthDTO userAuth = new AuthDTO();
        userAuth.setGrantToObjId(creatorUserId);
        userAuth.setGrantToObjType(GrantToObjType.USER);

        AuthRedBlackDTO authRedBlackDTO = new AuthRedBlackDTO();
        authRedBlackDTO.setGrantObjId(ssResource.getResourceId());
        authRedBlackDTO.setGrantObjType(ssResource.getResourceBizType());
        authRedBlackDTO.setGrantType(grantType);
        authRedBlackDTO.setSourceSystem(ssResource.getSystemCode());
        authRedBlackDTO.setRedList(List.of(userAuth));
        return authRedBlackDTO;
    }

    private void validateResourceManageAuthAllowed(SsResource ssResource) {
        if (ssResource != null && (StringUtils.equals(ssResource.getOwnerType(), OwnerType.PERSONAL_DEFAULT)
            || isPersonalAssistantResource(ssResource))) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("auth.personal.assistant.manage.auth.not.allowed"));
        }
    }

    private void validateResourceUseApplyAllowed(SsResource ssResource) {
        if (!isPersonalResourceUseApplyUnsupported(ssResource)) {
            return;
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
    }

    private void validateResourceUseApplyAuditAllowed(SsResource ssResource) {
        if (!isPersonalResourceUseApplyUnsupported(ssResource)) {
            return;
        }
        throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
    }

    private void writeRedisForShareUse(CompareVo compareVo, Long grantObjId) {
        Map<String, PrivilegeGrant> redAddMap = compareVo.getRedAddMap();
        Map<String, PrivilegeGrant> redDelMap = compareVo.getRedDelMap();
        String shareOrgKey = GrantObjType.KG_DOC + Constants.SHARE_ORG_ + grantObjId;
        String shareUserKey = GrantObjType.KG_DOC + Constants.SHARE_USER_ + grantObjId;

        writeToRedis(redAddMap, shareUserKey, shareOrgKey);
        deleteFromRedis(redDelMap, shareUserKey, shareOrgKey);

    }

    private void deleteFromRedis(Map<String, PrivilegeGrant> redDelMap, String shareUserKey, String shareOrgKey) {
        Set<Long> delOrgIds = new HashSet<>();
        Set<Long> delUserIds = new HashSet<>();
        for (PrivilegeGrant privilegeGrant : redDelMap.values()) {
            if (privilegeGrant.getGrantObjType().equals(GrantToObjType.ORG)) {
                delOrgIds.add(privilegeGrant.getGrantToObjId());
            }
            if (privilegeGrant.getGrantObjType().equals(GrantToObjType.USER)) {
                delUserIds.add(privilegeGrant.getGrantToObjId());
            }
        }
        // 删除用户权限
        if (CollectionUtils.isNotEmpty(delOrgIds)) {
            String[] userIds = delUserIds.stream().map(String::valueOf).toArray(String[]::new);
            RedisUtil.removeSet(shareUserKey, userIds);
        }

        // 删除组织权限
        if (!delOrgIds.isEmpty()) {
            String[] orgIds = delOrgIds.stream().map(String::valueOf).toArray(String[]::new);
            RedisUtil.removeSet(shareOrgKey, orgIds);
        }
    }

    private void writeToRedis(Map<String, PrivilegeGrant> redAddMap, String shareUserKey, String shareOrgKey) {
        Set<Long> addOrgIds = new HashSet<>();
        Set<Long> addUserIds = new HashSet<>();
        for (PrivilegeGrant privilegeGrant : redAddMap.values()) {
            if (privilegeGrant.getGrantToObjType().equals(GrantToObjType.ORG)) {
                addOrgIds.add(privilegeGrant.getGrantToObjId());
            }
            if (privilegeGrant.getGrantToObjType().equals(GrantToObjType.USER)) {
                addUserIds.add(privilegeGrant.getGrantToObjId());
            }
        }
        // 添加用户权限
        if (!addUserIds.isEmpty()) {
            String[] userIds = addUserIds.stream().map(String::valueOf).toArray(String[]::new);
            RedisUtil.addSet(shareUserKey, userIds);
        }
        // 添加组织权限
        if (!addOrgIds.isEmpty()) {
            String[] orgIds = addOrgIds.stream().map(String::valueOf).toArray(String[]::new);
            RedisUtil.addSet(shareOrgKey, orgIds);
        }

    }

    /**
     * 处理新增
     *
     * @param grantType 授权类型
     * @param addMap 新增红黑名单集合
     */
    private void handleAdd(String grantType, Map<String, PrivilegeGrant> addMap) {

        for (Map.Entry<String, PrivilegeGrant> entry : addMap.entrySet()) {
            String key = entry.getKey();
            PrivilegeGrant privilegeGrant = entry.getValue();
            // 如果不存在权限，数据库新增新增权限
            privilegeGrant.setStatusCd("A");
            privilegeGrantService.save(privilegeGrant);

            // 授权信息
            String[] splitArray = key.split("\\|");

            // 缓存新增权限
            this.writeRedis(grantType, splitArray[0], splitArray[1]);
        }
    }

    /**
     * 处理删除
     *
     * @param grantType 授权类型
     * @param updateMap 更新红黑名单集合
     */
    private void handleUpdate(String grantType, Map<String, PrivilegeGrant> updateMap) {
        for (Map.Entry<String, PrivilegeGrant> entry : updateMap.entrySet()) {

            String key = entry.getKey();
            PrivilegeGrant privilegeGrant = entry.getValue();

            // 如果不存在权限，数据库新增新增权限
            privilegeGrantService.update(privilegeGrant);

            // 授权信息
            String[] splitArray = key.split("\\|");

            // 刷新缓存
            this.writeRedis(grantType, splitArray[0], splitArray[1]);
        }
    }

    /**
     * 处理删除
     *
     * @param grantType 授权类型
     * @param delMap 删除红黑名单集合
     */
    private void handleDel(String grantType, Map<String, PrivilegeGrant> delMap) {

        for (Map.Entry<String, PrivilegeGrant> entry : delMap.entrySet()) {

            String key = entry.getKey();
            PrivilegeGrant privilegeGrant = entry.getValue();

            // 如果不存在权限，数据库新增新增权限
            privilegeGrantService.remove(privilegeGrant);

            // 授权信息
            String[] splitArray = key.split("\\|");

            // 缓存新增权限
            this.removeRedis(grantType, splitArray[0], splitArray[1]);
        }
    }

    private Long getKnowledgeBaseId(Long grantObjId) {
        SsResource ssResource = ssResourceMapper.selectById(grantObjId);
        if (ssResource != null) {
            return ssResource.getResourceSourcePkId();
        }
        return null;
    }

    /**
     * 构建类型
     */
    // * @param grantType 授权类型
    // * @param grantObjType 授权标识
    // * @param grantObjId 授权
    // * @param authList 授权列表
    // * @param color 红黑名单
    // * @param allowSubscribe
    // * @return List<PrivilegeGrant>
    private List<PrivilegeGrant> buildAuth(String grantType, String grantObjType, Long grantObjId,
        List<AuthDTO> authList, String color, String allowSubscribe) {

        List<PrivilegeGrant> privilegeGrantList = new ArrayList<>(10);
        for (int i = 0; authList != null && i < authList.size(); i++) {

            AuthDTO authDTO = authList.get(i);
            PrivilegeGrant privilegeGrant = new PrivilegeGrant();
            privilegeGrant.setGrantType(grantType);
            privilegeGrant.setGrantObjId(grantObjId);
            privilegeGrant.setGrantObjType(grantObjType);
            // 红黑名单都用grantToObjId和grantToObjType这两个字段
            privilegeGrant.setGrantToObjType(authDTO.getGrantToObjType());
            privilegeGrant.setGrantToObjId(authDTO.getGrantToObjId());
            privilegeGrant.setOperType(OperType.READ);
            // 加上是否允许订阅
            privilegeGrant.setAllowUnsubscribe(allowSubscribe);
            // 设置红名单
            if (Color.RED.equalsIgnoreCase(color)) {
                privilegeGrant.setGrantToType(Color.RED);
            }
            else if (Color.BLACK.equalsIgnoreCase(color)) {
                privilegeGrant.setGrantToType(Color.BLACK);
            }
            else {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.type.unsupported"));
            }
            privilegeGrantList.add(privilegeGrant);
        }
        return privilegeGrantList;
    }

    /**
     * 对比处理授权信息
     *
     * @param grantType 授权范围，AVAILABLE_USE:使用授权,FORCE_USE：强制使用ALLOW_MANAGE:管理授权
     * @param privilegeGrantList 当前权限
     * @param historyList 历史授权列表
     * @param color 红黑名单
     * @param compareVo 对比结果
     */
    private void comparePrivilegeGrant(String grantType, List<PrivilegeGrant> privilegeGrantList,
        List<PrivilegeGrant> historyList, String color, CompareVo compareVo) {

        Map<String, PrivilegeGrant> historyRedMap = this.buildPrivilegeGrantMap(historyList);
        Map<String, PrivilegeGrant> redMap = this.buildPrivilegeGrantMap(privilegeGrantList);

        for (Map.Entry<String, PrivilegeGrant> entry : redMap.entrySet()) {
            String key = entry.getKey();

            // 当前权限信息key=DATASET:AUTHORITY:1_RED_READ_PERSON_1000901|AGENT_418202897625
            logger.info("当前权限信息grantType={},key={}", grantType, key);

            PrivilegeGrant privilegeGrant = entry.getValue();

            PrivilegeGrant historyPrivilegeGrant = historyRedMap.remove(key);
            if (historyPrivilegeGrant != null) {
                if (Color.RED.equalsIgnoreCase(color)) {
                    compareVo.getRedUpdateMap().put(key, historyPrivilegeGrant);
                }
                else if (Color.BLACK.equalsIgnoreCase(color)) {
                    compareVo.getBlackUpdateMap().put(key, historyPrivilegeGrant);
                }
            }
            else {
                if (shouldSkipSameDimensionDuplicateGrant(grantType, privilegeGrant)) {
                    continue;
                }
                if (Color.RED.equalsIgnoreCase(color)) {
                    compareVo.getRedAddMap().put(key, privilegeGrant);
                }
                else if (Color.BLACK.equalsIgnoreCase(color)) {
                    compareVo.getBlackAddMap().put(key, privilegeGrant);
                }
            }
        }

        // 经过对比之后，本次新增不涉及的权限，表示已经页面已经移除，后台同步移除
        for (Map.Entry<String, PrivilegeGrant> entry : historyRedMap.entrySet()) {
            if (Color.RED.equalsIgnoreCase(color)) {
                compareVo.getRedDelMap().put(entry.getKey(), entry.getValue());
            }
            else if (Color.BLACK.equalsIgnoreCase(color)) {
                compareVo.getBlackDelMap().put(entry.getKey(), entry.getValue());
            }
        }
    }

    /**
     * 权限写入redis，现在只有使用类型会写入redis
     *
     * @param grantType 授权类型
     * @param key key
     * @param values value
     */
    private void writeRedis(String grantType, String key, String... values) {
        if (GrantType.AVAILABLE_USE.equalsIgnoreCase(grantType) || GrantType.SHARE_USE.equalsIgnoreCase(grantType)
            || GrantType.FORCE_USE.equalsIgnoreCase(grantType)) {
            RedisUtil.addSet(key, values);
        }
    }

    /**
     * 权限除除redis，现在只有使用类型会进行redis操作
     *
     * @param grantType 授权类型
     * @param key key
     * @param values value
     */
    private void removeRedis(String grantType, String key, String... values) {
        if (GrantType.AVAILABLE_USE.equalsIgnoreCase(grantType) || GrantType.SHARE_USE.equalsIgnoreCase(grantType)
            || GrantType.FORCE_USE.equalsIgnoreCase(grantType)) {
            RedisUtil.removeSet(key, values);
        }
    }

    /**
     * @param privilegeGrantList 权限列表
     * @return Map
     */
    private Map<String, PrivilegeGrant> buildPrivilegeGrantMap(List<PrivilegeGrant> privilegeGrantList) {

        Map<String, PrivilegeGrant> privilegeGrantMap = new HashMap<>(20);

        for (PrivilegeGrant privilegeGrant : privilegeGrantList) {
            String key = this.buildPrivilegeGrantKey(privilegeGrant);
            String value = this.buildPrivilegeGrantValue(privilegeGrant);
            privilegeGrantMap.put(key + "|" + value, privilegeGrant);
        }
        return privilegeGrantMap;
    }

    /**
     * 获取授权的key信息
     *
     * @param privilegeGrant 授权信息
     * @return String
     */
    protected String buildPrivilegeGrantKey(PrivilegeGrant privilegeGrant) {

        String grantType = privilegeGrant.getGrantType();

        String operType = privilegeGrant.getOperType();
        String color = null;
        if (StringUtils.isBlank(privilegeGrant.getGrantToType())) {
            color = "RED";
        }
        else {
            color = privilegeGrant.getGrantToType();
        }
        String grantToObjType = privilegeGrant.getGrantToObjType();

        Long grantToObjId = privilegeGrant.getGrantToObjId();

        return this.buildTemplateKey(grantType, color, operType, grantToObjType, grantToObjId);
    }

    /**
     * 构建权限的key
     *
     * @param grantType 授权类型
     * @param color 红黑名单
     * @param operType 读写类型
     * @param grantToObjType 授权对象类型
     * @param grantToObjId 授权对象标识
     * @return String
     */
    protected String buildTemplateKey(String grantType, String color, String operType, String grantToObjType,
        Long grantToObjId) {

        // 获取对应的key
        String templateKey = "DATASET:AUTHORITY:{range}_{color}_{redOrWrite}_{grantToObjType}_{grantToObjId}";
        // 变量替换
        return templateKey.replace("{range}", this.getRange(grantType)) // 授权范围
            .replace("{color}", color) // 红黑名单
            .replace("{redOrWrite}", operType) // 读写权限
            .replace("{grantToObjType}", this.getGrantToObjType(grantToObjType)) // 授权类型
            .replace("{grantToObjId}", grantToObjId + ""); // 授权对象标识
    }

    /**
     * 构建权限授权Value 基于实际的Value构建规则：{RESOURCE_TYPE}_{resourceId}
     *
     * @param privilegeGrant 权限授权记录
     * @return Redis Value
     */
    protected String buildPrivilegeGrantValue(PrivilegeGrant privilegeGrant) {
        if (privilegeGrant == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.privilege.grant.not.null"));
        }

        String grantObjType = privilegeGrant.getGrantObjType();
        Long grantObjId = privilegeGrant.getGrantObjId();

        if (grantObjType == null || grantObjId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("auth.grant.obj.type.and.id.not.null"));
        }

        String valuePrefix = ResourceTypeValueMapping.getValuePrefix(grantObjType);
        if (!ResourceTypeValueMapping.isSupported(grantObjType)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("auth.grant.doc.notfound", grantObjType));
        }

        return valuePrefix + "_" + grantObjId;
    }

    /**
     * 获取授权对象类型映射
     *
     * @param grantToObjType 授权对象类型
     * @return 转换后的类型
     */
    private String getGrantToObjType(String grantToObjType) {
        String targetType = GrantToObjTypeMapping.getTargetType(grantToObjType);
        if (targetType == null) {
            // 如果映射失败，说明不支持该类型
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.grant.scope.notfound"));
        }
        return targetType;
    }

    /**
     * 获取授权范围
     *
     * @param grantType 授权类型
     * @return 范围标识
     */
    private String getRange(String grantType) {
        String range = GrantTypeRangeMapping.getRange(grantType);
        if (range == null || !GrantTypeRangeMapping.isSupported(grantType)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("auth.grant.granttype.notfound"));
        }
        return range;
    }

    /**
     * 同授权维度去重：
     * 同一 grantToObjType + grantToObjId 下，如果已经持有同一权限族的有效授权，则不再重复新增新的授权关系。
     * 不同维度之间互不去重，例如组织已授权后，继续给个人授权仍然允许新增。
     */
    private boolean shouldSkipSameDimensionDuplicateGrant(String grantType, PrivilegeGrant privilegeGrant) {
        List<String> sameFamilyGrantTypes = resolveSameFamilyGrantTypes(grantType);
        if (CollectionUtils.isEmpty(sameFamilyGrantTypes) || privilegeGrant == null
            || StringUtils.isBlank(privilegeGrant.getGrantToObjType()) || privilegeGrant.getGrantToObjId() == null) {
            return false;
        }
        return hasSameDimensionPermissionFamily(privilegeGrant.getGrantObjType(), privilegeGrant.getGrantObjId(),
            privilegeGrant.getGrantToObjType(), privilegeGrant.getGrantToObjId(), sameFamilyGrantTypes);
    }

    /**
     * 查询同一授权维度下是否已存在有效授权关系。
     */
    private boolean hasSameDimensionPermissionFamily(String grantObjType, Long grantObjId, String grantToObjType,
        Long grantToObjId, List<String> grantTypes) {
        if (StringUtils.isBlank(grantObjType) || grantObjId == null || StringUtils.isBlank(grantToObjType)
            || grantToObjId == null || CollectionUtils.isEmpty(grantTypes)) {
            return false;
        }
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantObjType, grantObjType);
        queryWrapper.eq(PrivilegeGrant::getGrantObjId, grantObjId);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjType, grantToObjType);
        queryWrapper.eq(PrivilegeGrant::getGrantToObjId, grantToObjId);
        queryWrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        queryWrapper.eq(PrivilegeGrant::getOperType, OperType.READ);
        queryWrapper.eq(PrivilegeGrant::getStatusCd, "A");
        queryWrapper.in(PrivilegeGrant::getGrantType, grantTypes);
        return privilegeGrantMapper.selectCount(queryWrapper) > 0;
    }

    /**
     * 权限族映射：管理权限按自身去重；使用权限需要在 AVAILABLE_USE/FORCE_USE 之间跨 grantType 去重。
     */
    private List<String> resolveSameFamilyGrantTypes(String grantType) {
        if (GrantType.ALLOW_MANAGE.equals(grantType)) {
            return List.of(GrantType.ALLOW_MANAGE);
        }
        if (GrantType.AVAILABLE_USE.equals(grantType) || GrantType.FORCE_USE.equals(grantType)) {
            return List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE);
        }
        return Collections.emptyList();
    }

    /**
     * 获取授权详情
     *
     * @param authDetailQo 授权对象
     * @return ResponseUtil
     */
    public ResponseUtil listAuthDetail(AuthDetailQo authDetailQo) {

        // 查询授权信息
        LambdaQueryWrapper<PrivilegeGrant> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PrivilegeGrant::getGrantType, authDetailQo.getGrantType());
        queryWrapper.eq(PrivilegeGrant::getGrantObjType, authDetailQo.getGrantObjType());
        queryWrapper.eq(PrivilegeGrant::getGrantObjId, authDetailQo.getGrantObjId());
        queryWrapper.eq(PrivilegeGrant::getStatusCd, "A");
        List<PrivilegeGrant> privilegeGrants = privilegeGrantMapper.selectList(queryWrapper);

        Map<String, AuthDTO> redMap = new LinkedHashMap<>(100);
        Map<String, AuthDTO> blackMap = new LinkedHashMap<>(100);
        for (PrivilegeGrant privilegeGrant : privilegeGrants) {

            // 红黑名单权限授予对象类型,USER:人员,ORG:组织,POST:岗位
            Long grantToObjId = privilegeGrant.getGrantToObjId();
            String grantToType = privilegeGrant.getGrantToType();
            String grantToObjType = privilegeGrant.getGrantToObjType();

            AuthDTO authDTO = new AuthDTO();
            authDTO.setGrantToObjId(grantToObjId);
            authDTO.setGrantToObjType(grantToObjType);
            authDTO.setGrantToObjName(this.getName(grantToObjType, grantToObjId));
            String grantTargetKey = buildGrantTargetKey(grantToType, grantToObjType, grantToObjId);
            if (Color.RED.equalsIgnoreCase(grantToType)) {
                redMap.putIfAbsent(grantTargetKey, authDTO);
            }
            else if (Color.BLACK.equalsIgnoreCase(grantToType)) {
                blackMap.putIfAbsent(grantTargetKey, authDTO);
            }
        }

        // 返回授权信息
        Map<String, Object> resultMap = new HashMap<>(5);
        resultMap.put("grantType", authDetailQo.getGrantType());
        resultMap.put("redList", new ArrayList<>(redMap.values()));
        resultMap.put("blackList", new ArrayList<>(blackMap.values()));
        return ResponseUtil.successResponse(I18nUtil.get("auth.detail.query.success"), resultMap);
    }

    private String buildGrantTargetKey(String grantToType, String grantToObjType, Long grantToObjId) {
        return StringUtils.trimToEmpty(grantToType) + "_" + StringUtils.trimToEmpty(grantToObjType) + "_"
            + String.valueOf(grantToObjId);
    }

    /**
     * 获取授权对象名称回显
     *
     * @param toObjType 黑名单权限授予对象类型USER:人员,ORG:组织,POST:岗位,STATION:驻地
     * @param toObjId 授权对象标识
     * @return String
     */
    public String getName(String toObjType, Long toObjId) {
        if (GrantToObjType.USER.equalsIgnoreCase(toObjType)) {
            Users users = userService.findById(toObjId);
            return users != null ? users.getUserName() : null;
        }
        else if (GrantToObjType.ORG.equalsIgnoreCase(toObjType)) {
            Organization organization = organizationService.findById(toObjId);
            return organization != null ? organization.getOrgName() : null;
        }
        else if (GrantToObjType.POST.equalsIgnoreCase(toObjType)) {
            Position position = positionService.findById(toObjId);
            return position != null ? position.getPositionName() : null;
        }
        else if (GrantToObjType.STATION.equalsIgnoreCase(toObjType)) {
            Station station = stationService.getById(toObjId);
            return station != null ? station.getStationName() : null;
        }
        return null;
    }

    public Map<String, Object> getAuthList(PriviledgeQo priviledgeQo) {

        Page<AuthVo> page = new Page<>(priviledgeQo.getPageIndex(), priviledgeQo.getPageSize());
        List<AuthVo> authList = privilegeGrantMapper.getAuthList(page, priviledgeQo);
        // 当前用户作为管理员
        Map<String, Object> resultMap = new HashMap<>(5);
        page.setRecords(authList);
        PageInfo<AuthVo> pageInfo = PageHelperUtil.toPageInfo(page);
        buildPageInfo(pageInfo, resultMap);
        // resultMap.put("data", authList);
        int userNum = 0;
        int orgNum = 0;
        for (AuthVo item : authList) {
            if (GrantToObjType.USER.equals(item.getGrantToObjType())) {
                userNum++;
            }
            if (GrantToObjType.ORG.equals(item.getGrantToObjType())) {
                orgNum++;
            }
        }
        resultMap.put("userNum", userNum);
        resultMap.put("orgNum", orgNum);
        return resultMap;
    }

    private void buildPageInfo(PageInfo<AuthVo> page, Map<String, Object> resultMap) {
        Map<String, Object> pageInfoMap = new HashMap<>(5);
        pageInfoMap.put("pageNum", page.getPageNum());
        pageInfoMap.put("pageSize", page.getPageSize());
        pageInfoMap.put("total", page.getTotal());
        pageInfoMap.put("totalPage", page.getTotalPages());
        resultMap.put("pageInfo", pageInfoMap);
        resultMap.put("rows", page.getList());
    }

    /**
     * 组织使用授权
     *
     * @param authManOrgDTO 红黑名单授权对象
     * @return ResponseUtil
     */
    public void mangerOrgUseAuth(AuthManOrgDTO authManOrgDTO) {

        // 查询历史数据
        PrivilegeGrantQo privilegeGrantQo = new PrivilegeGrantQo();
        privilegeGrantQo.setGrantToObjType(authManOrgDTO.getGrantToObjType());
        privilegeGrantQo.setGrantToObjId(authManOrgDTO.getGrantToObjId());
        privilegeGrantQo.setGrantObjType(authManOrgDTO.getGrantObjType());
        List<PrivilegeGrant> historyPrivilegeGrantList = privilegeGrantService.findPrivilegeByQo(privilegeGrantQo);

        List<ManOrgDTO> redList = authManOrgDTO.getRedList();
        if (ListUtil.isNotEmpty(redList)) {

            Map<Long, PrivilegeGrant> historyPrivilegeGrantMap = this
                .buildMangerOrgPrivateMap(historyPrivilegeGrantList);

            List<PrivilegeGrant> redPrivilegeGrant = new ArrayList<>(10);
            for (ManOrgDTO manOrgDTO : redList) {
                PrivilegeGrant privilegeGrant = new PrivilegeGrant();
                privilegeGrant.setGrantType(authManOrgDTO.getGrantType());
                privilegeGrant.setGrantToObjType(authManOrgDTO.getGrantToObjType());
                privilegeGrant.setGrantToObjId(authManOrgDTO.getGrantToObjId());
                privilegeGrant.setGrantToType(Color.RED);
                privilegeGrant.setOperType(OperType.READ);
                privilegeGrant.setGrantObjType(manOrgDTO.getGrantObjType());
                privilegeGrant.setGrantObjId(manOrgDTO.getGrantObjId());
                redPrivilegeGrant.add(privilegeGrant);
            }

            Map<Long, PrivilegeGrant> redPrivilegeGrantMap = this.buildMangerOrgPrivateMap(redPrivilegeGrant);
            for (Map.Entry<Long, PrivilegeGrant> entry : redPrivilegeGrantMap.entrySet()) {
                Long grantObjId = entry.getKey();
                PrivilegeGrant privilegeGrant = entry.getValue();

                PrivilegeGrant historyPrivilegeGrant = historyPrivilegeGrantMap.remove(grantObjId);

                if (historyPrivilegeGrant != null) {
                    privilegeGrantService.update(historyPrivilegeGrant);
                    // 同步更新Redis缓存
                    String redisKey = this.buildPrivilegeGrantKey(historyPrivilegeGrant);
                    String redisValue = this.buildPrivilegeGrantValue(historyPrivilegeGrant);
                    this.writeRedis(authManOrgDTO.getGrantType(), redisKey, redisValue);
                }
                else {
                    privilegeGrant.setStatusCd("A");
                    privilegeGrantService.save(privilegeGrant);
                    // 同步写入Redis缓存
                    String redisKey = this.buildPrivilegeGrantKey(privilegeGrant);
                    String redisValue = this.buildPrivilegeGrantValue(privilegeGrant);
                    this.writeRedis(authManOrgDTO.getGrantType(), redisKey, redisValue);
                }
            }

            // 删除多余的
            Collection<PrivilegeGrant> values = historyPrivilegeGrantMap.values();
            for (PrivilegeGrant privilegeGrant : values) {
                privilegeGrantService.remove(privilegeGrant);
                // 同步删除Redis缓存
                String redisKey = this.buildPrivilegeGrantKey(privilegeGrant);
                String redisValue = this.buildPrivilegeGrantValue(privilegeGrant);
                this.removeRedis(authManOrgDTO.getGrantType(), redisKey, redisValue);
            }

        }
        else {
            // 清空所有权限
            for (PrivilegeGrant privilegeGrant : historyPrivilegeGrantList) {
                privilegeGrantService.remove(privilegeGrant);
                // 同步删除Redis缓存
                String redisKey = this.buildPrivilegeGrantKey(privilegeGrant);
                String redisValue = this.buildPrivilegeGrantValue(privilegeGrant);
                this.removeRedis(authManOrgDTO.getGrantType(), redisKey, redisValue);
            }
        }
    }

    /**
     * 构建权限集合
     *
     * @param privilegeGrantList 权限列表
     * @return
     */
    private Map<Long, PrivilegeGrant> buildMangerOrgPrivateMap(List<PrivilegeGrant> privilegeGrantList) {
        Map<Long, PrivilegeGrant> mangerOrgPrivateMap = new HashMap<>(10);
        for (PrivilegeGrant privilegeGrant : privilegeGrantList) {
            mangerOrgPrivateMap.put(privilegeGrant.getGrantObjId(), privilegeGrant);
        }
        return mangerOrgPrivateMap;
    }

    /**
     * @param authManQo
     * @return ResponseUtil
     */
    public ResponseUtil listMangerOrgUseDetail(AuthManQo authManQo) {
        // 返回授权信息
        Map<String, Object> resultMap = new HashMap<>(5);
        resultMap.put("grantType", authManQo.getGrantType());
        resultMap.put("redList", privilegeGrantService.listMangerOrgUseDetail(authManQo));

        return ResponseUtil.successResponse(I18nUtil.get("auth.org.use.detail.query.success"), resultMap);
    }

    public ResponseUtil delShare(PrivilegeGrant priviledgeGrant) {
        privilegeGrantService.removePriv(priviledgeGrant);
        return ResponseUtil.success(I18nUtil.get("auth.share.remove.success"));
    }

    public ResponseUtil listAuthDetailByGroup(AuthDetailQo authDetailQo) {
        List<PrivilegeGrant> privilegeGrantList = privilegeGrantMapper.queryPriviledgeWithOrgLevel(authDetailQo);
        List<AuthDTO> redList = new ArrayList<>(100);
        List<AuthDTO> blackList = new ArrayList<>(100);
        for (PrivilegeGrant privilegeGrant : privilegeGrantList) {
            // 红黑名单权限授予对象类型,USER:人员,ORG:组织,POST:岗位
            Long grantToObjId = privilegeGrant.getGrantToObjId();
            String grantToObjType = privilegeGrant.getGrantToObjType();
            String grantToType = privilegeGrant.getGrantToType();
            AuthDTO authDTO = new AuthDTO();
            if (StringUtil.isNotEmpty(grantToObjType) && grantToObjId != null) {
                authDTO.setGrantToObjType(grantToObjType);
                authDTO.setGrantToObjId(grantToObjId);
                authDTO.setGrantToObjName(this.getName(grantToObjType, grantToObjId));
                if (grantToType.equalsIgnoreCase(Color.RED)) {
                    redList.add(authDTO);
                }
                else {
                    blackList.add(authDTO);
                }
            }
        }
        // 返回授权信息
        Map<String, Object> resultMap = new HashMap<>(5);
        dealRedOrBlackGroup(redList, blackList, resultMap);
        return ResponseUtil.successResponse(I18nUtil.get("auth.detail.group.query.success"), resultMap);
    }

    private void dealRedOrBlackGroup(List<AuthDTO> redList, List<AuthDTO> blackList, Map<String, Object> resultMap) {
        dealRedOrBlackGroup(redList, resultMap, Color.RED);
        dealRedOrBlackGroup(blackList, resultMap, Color.BLACK);
    }

    private void dealRedOrBlackGroup(List<AuthDTO> authList, Map<String, Object> resultMap, String color) {
        if (CollectionUtils.isEmpty(authList)) {
            resultMap.put(Color.RED.equalsIgnoreCase(color) ? "redList" : "blackList", new HashMap<>());
            return;
        }
        // 按照 grantToObjType 分组
        Map<String, List<AuthDTO>> colorMap = new HashMap<>();
        authList.forEach(item -> {
            if (!colorMap.containsKey(item.getGrantToObjType())) {
                colorMap.put(item.getGrantToObjType(), new ArrayList<>());
            }
            colorMap.get(item.getGrantToObjType()).add(item);
        });

        // 处理排序后的列表
        resultMap.put(Color.RED.equalsIgnoreCase(color) ? "redList" : "blackList", colorMap);
    }

    // 以下方法已迁移到 ResourceAuthApplicationService?
    // - listDigitalEmployeeAuth()
    // - listResourceAuth()
    // - getQueryMap()

    public void batchUpdatePrivList(DirectUnsubscribeDto directUnsubscribeDto) {
        Long userId = CurrentUserHolder.getCurrentUserId();

        // 批量更新权限状态
        LambdaUpdateWrapper<PrivilegeGrant> updateWrapper = new LambdaUpdateWrapper<>();
        updateWrapper.in(PrivilegeGrant::getGrantObjId, directUnsubscribeDto.getIdList());
        updateWrapper.eq(PrivilegeGrant::getGrantToObjId, userId);
        updateWrapper.eq(PrivilegeGrant::getGrantToObjType, GrantToObjType.USER);
        updateWrapper.eq(PrivilegeGrant::getGrantToType, Color.RED);
        updateWrapper.eq(PrivilegeGrant::getStatusCd, "A");
        updateWrapper.set(PrivilegeGrant::getStatusCd, "X");
        privilegeGrantMapper.update(updateWrapper);

        // 处理授权订阅明细表的状态更?
        for (Long resourceId : directUnsubscribeDto.getIdList()) {
            superassistSubAgentService.handleDirectUnsubscribe(userId, resourceId);
        }
    }

    public List<Long> listAuthByType(ResourceAuthQo resourceAuthQo) {

        List<PrivilegeGrant> res = listAuthPrivilegeGrant(resourceAuthQo.getGrantType(),
            List.of(resourceAuthQo.getGrantObjType()), resourceAuthQo.getGrantToObjType(),
            resourceAuthQo.getGrantToObjId(), resourceAuthQo.getGrantTypeList());
        return res.stream().map(PrivilegeGrant::getGrantObjId).collect(Collectors.toList());
    }

    /**
     * @param authRedBlackDTO 批量处理权限 分开考虑不同grantType：
     */
    public void batchHandleAuth(AuthRedBlackDTO authRedBlackDTO) {
        List<AuthRedBlackDTO> authList = buildAuthList(authRedBlackDTO);
        // 遍历：分别处理不同类型的权限
        for (AuthRedBlackDTO auth : authList) {
            handleAuth(auth);
        }
    }

    /**
     * 根据授权类型生成红黑名单分组
     *
     * @param listMap 红黑名单映射
     * @param authList 授权对象列表
     */
    private void generateRedOrBlackGroup(Map<String, List<AuthDTO>> listMap, List<AuthDTO> authList) {
        if (CollectionUtils.isNotEmpty(authList)) {
            for (AuthDTO authDTO : authList) {
                // 获取授权类型，如果未设置则使用默认授权类型
                String grantType = null == authDTO.getGrantType() ? GrantType.FORCE_USE : authDTO.getGrantType();

                if (StringUtils.isEmpty(grantType)) {
                    // 如果没有授权类型，则跳过
                    continue;
                }

                // 将授权对象添加到对应授权类型的列表中
                if (!listMap.containsKey(grantType)) {
                    listMap.put(grantType, new ArrayList<>());
                }
                listMap.get(grantType).add(authDTO);
            }
        }
    }

    private List<AuthRedBlackDTO> buildAuthList(AuthRedBlackDTO authRedBlackDTO) {
        // 结果列表
        List<AuthRedBlackDTO> resultList = new ArrayList<>();

        // 按grantType分组的映?
        Map<String, List<AuthDTO>> redListMap = new HashMap<>();
        Map<String, List<AuthDTO>> blackListMap = new HashMap<>();

        // 处理红名单分?
        generateRedOrBlackGroup(redListMap, authRedBlackDTO.getRedList());

        // 处理黑名单分?
        generateRedOrBlackGroup(blackListMap, authRedBlackDTO.getBlackList());

        // 收集所有唯一的授权类型
        Set<String> allGrantTypes = new HashSet<>();
        allGrantTypes.addAll(redListMap.keySet());
        allGrantTypes.addAll(blackListMap.keySet());

        // 确保FORCE_USE和AVAILABLE_USE这两种类型一定存?
        allGrantTypes.add(GrantType.FORCE_USE);
        allGrantTypes.add(GrantType.AVAILABLE_USE);

        // 为每个授权类型创建一个新的AuthRedBlackDTO
        for (String grantType : allGrantTypes) {
            AuthRedBlackDTO newDTO = new AuthRedBlackDTO();

            // 复制基本属?
            BeanUtils.copyProperties(authRedBlackDTO, newDTO);

            // 设置当前处理的授权类型
            newDTO.setGrantType(grantType);
            newDTO.setGrantTypes(null); // 清除grantTypes，避免递归

            // 设置对应授权类型的红名单和黑名单
            newDTO.setRedList(redListMap.getOrDefault(grantType, new ArrayList<>()));
            newDTO.setBlackList(blackListMap.getOrDefault(grantType, new ArrayList<>()));

            // 添加到结果列?
            resultList.add(newDTO);
        }

        return resultList;
    }

    public Map<Long, Integer> getAgentSubNum(PrivListQo request) {
        List<Map<String, Object>> agentSubNum = privilegeGrantMapper.getAgentSubNum(request);
        Map<Long, Integer> agentSubNumMap = new HashMap<>();
        agentSubNum.forEach(item -> {
            Long agentId = MapUtils.getLong(item, "agentId");
            Integer subNum = MapUtils.getInteger(item, "subNum");
            agentSubNumMap.put(agentId, subNum);
        });
        return agentSubNumMap;
    }

    public Map<Long, Map<String, String>> queryAllManPrivInfo(PrivListQo request) {
        List<Long> resourceIds = request.getGrantObjIdList();
        return privilegeGrantService.queryManPrivMap(resourceIds);

    }

    public void grantUsePrivToAll(SsResource resource) {

        List<Long> topOrgList = organizationService.getTopOrgList();

        AuthRedBlackDTO authRedBlackDTO = new AuthRedBlackDTO();
        authRedBlackDTO.setGrantType(GrantType.FORCE_USE);
        authRedBlackDTO.setGrantObjType(GrantObjType.DIG_EMPLOYEE);
        authRedBlackDTO.setRedList(buildRedList(topOrgList));
        authRedBlackDTO.setGrantObjId(resource.getResourceId());
        // 调用HandleAuth
        handleAuth(authRedBlackDTO);

    }

    private List<AuthDTO> buildRedList(List<Long> topOrgList) {
        List<AuthDTO> authDTOList = new ArrayList<>();
        for (Long orgId : topOrgList) {
            AuthDTO authDTO = new AuthDTO();
            authDTO.setGrantToObjId(orgId);
            authDTO.setGrantToObjType(GrantToObjType.ORG);
            authDTO.setGrantType(GrantType.FORCE_USE);
            authDTOList.add(authDTO);
        }
        return authDTOList;

    }

    public boolean hasPriv(Long resourceId) {
        return privilegeGrantService.hasForePriv(resourceId);
    }

    /**
     * 查询当前登录用户对指定资源的 6 项操作权限。
     * canSetDefault 已统一迁移到左侧“全部列表项”接口计算，这里固定返回 false，避免资源卡片继续出现旧入口。
     * 与列表查询返回的 canEdit/canManageAuth/... 字段语义保持一致。
     *
     * @param resourceId 资源 ID
     * @return 操作权限 VO
     * @throws BaseException 资源不存在时抛出
     * @author qin.guoquan
     * @date 2026-05-06
     */
    public ResourceOperationPermissionsVo queryResourceOperationPermissions(Long resourceId) {
        if (resourceId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.resourceid.notnull"));
        }
        SsResource ssResource = ssResourceService.findById(resourceId);
        if (ssResource == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }

        ResourceOperationPermissionsVo vo = new ResourceOperationPermissionsVo();
        vo.setResourceId(resourceId);
        vo.setOwnerType(ssResource.getOwnerType());
        vo.setResourceBizType(ssResource.getResourceBizType());

        boolean isResourceRemoved = Objects.equals(ssResource.getResourceStatus(), ResourceStatus.REMOVED.getNum());
        boolean canManage = hasResourceManagePermission(ssResource);

        // 如果资源已注销，只允许恢复操作，其他操作全部禁用
        if (isResourceRemoved) {
            vo.setCanEdit(false);
            vo.setCanManageAuth(false);
            vo.setCanUseAuth(false);
            vo.setCanDelete(false);
            vo.setCanAuditUse(false);
            vo.setCanApplyUse(false);
            vo.setCanSetDefault(false);
            vo.setCanRestore(canManage);
            return vo;
        }

        // 资源未注销时的原有逻辑
        boolean canSetUse = hasResourceUseSettingPermission(ssResource);
        boolean isDefaultResource = isDefaultPersonalResource(ssResource);
        boolean isDefaultSuperAssistantResource = isDefaultSuperAssistantResource(ssResource);
        boolean isBoundDefaultDigEmployee = isCurrentUserBoundDefaultDigitalEmployeeResource(ssResource);
        boolean isDigitalEmployee = ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(ssResource.getResourceBizType());
        // 个人助理类资源只作为个人空间资源使用，不开放管理授权、使用申请与使用申请审核入口。
        boolean isPersonalAssistantResource = isPersonalAssistantResource(ssResource);
        boolean isPersonalResourceUseApplyUnsupported = isPersonalResourceUseApplyUnsupported(ssResource);
        boolean isWhaleAgentExternalKnowledgeOrToolResource = isWhaleAgentExternalKnowledgeOrToolResource(ssResource);

        // 数字员工：默认助理本人豁免可编辑；其它资源：默认资源不可编辑/管理授权/注销
        boolean canEdit = isDigitalEmployee
            ? (canManage || isBoundDefaultDigEmployee)
            : (canManage && !isDefaultResource);
        // 默认超级助手是登录初始化的个人底座资源，即使当前用户绑定为默认助理，也不开放编辑入口。
        vo.setCanEdit(canEdit && !isDefaultSuperAssistantResource && !isWhaleAgentExternalKnowledgeOrToolResource);
        vo.setCanManageAuth(canManage && !isDefaultResource && !isDefaultSuperAssistantResource
            && !isPersonalAssistantResource);
        vo.setCanUseAuth(canSetUse && !isDefaultSuperAssistantResource);
        vo.setCanDelete(canManage && !isDefaultResource && !isDefaultSuperAssistantResource
            && !isWhaleAgentExternalKnowledgeOrToolResource);
        vo.setCanAuditUse(canSetUse && !isDefaultSuperAssistantResource && !isPersonalResourceUseApplyUnsupported);
        vo.setCanApplyUse(!isDefaultSuperAssistantResource && !isPersonalResourceUseApplyUnsupported
            && checkCanApplyUse(ssResource));

        // “设为默认”入口统一收敛到左侧“全部列表项”，个人/企业资源卡片不再展示该操作。
        vo.setCanSetDefault(false);
        return vo;
    }

    /**
     * 判断是否为个人助理资源。
     * personal 表示普通个人助理，personal_default 表示默认个人助理或默认超级助手，均不允许走对外申请/审核/管理授权。
     */
    private boolean isPersonalAssistantResource(SsResource ssResource) {
        if (ssResource == null || !ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(ssResource.getResourceBizType())) {
            return false;
        }
        return OwnerType.PERSONAL.equals(ssResource.getOwnerType())
            || OwnerType.PERSONAL_DEFAULT.equals(ssResource.getOwnerType());
    }

    /**
     * 个人 tab 资源采用“有管理权限的人主动授权”模式，不开放使用申请和使用审核。
     */
    private boolean isPersonalResourceUseApplyUnsupported(SsResource ssResource) {
        if (ssResource == null) {
            return false;
        }
        if (!OwnerType.PERSONAL.equals(ssResource.getOwnerType())
            && !OwnerType.PERSONAL_DEFAULT.equals(ssResource.getOwnerType())) {
            return false;
        }
        return isPersonalAssistantResource(ssResource)
            || isKnowledgeBizType(ssResource.getResourceBizType())
            || isToolBizType(ssResource.getResourceBizType())
            || ResourceBizTypeEnum.OBJECT.name().equals(ssResource.getResourceBizType())
            || ResourceBizTypeEnum.VIEW.name().equals(ssResource.getResourceBizType());
    }

    /**
     * WHALE_AGENT 模式下，知识/工具由外部智能体体系发布，本系统不允许编辑基础信息或注销。
     */
    private boolean isWhaleAgentExternalKnowledgeOrToolResource(SsResource ssResource) {
        if (ssResource == null
            || !SystemCode.WHAGE_AGENT.getCode().equalsIgnoreCase(StringUtils.trimToEmpty(datasetSystem))) {
            return false;
        }
        return isKnowledgeBizType(ssResource.getResourceBizType()) || isToolBizType(ssResource.getResourceBizType());
    }

    private boolean isKnowledgeBizType(String resourceBizType) {
        return StringUtils.startsWithIgnoreCase(StringUtils.trimToEmpty(resourceBizType), "KG_");
    }

    private boolean isToolBizType(String resourceBizType) {
        return StringUtils.equalsAny(StringUtils.trimToEmpty(resourceBizType),
            ResourceBizTypeEnum.AGENT.name(),
            ResourceBizTypeEnum.MCP.name(),
            ResourceBizTypeEnum.TOOLKIT.name(),
            ResourceBizTypeEnum.TOOL.name(),
            ResourceBizTypeEnum.MCP_TOOL.name());
    }

    /**
     * 判断资源是否为默认个人资源（owner_type = personal_default）。
     */
    private boolean isDefaultPersonalResource(SsResource ssResource) {
        return ssResource != null && OwnerType.PERSONAL_DEFAULT.equals(ssResource.getOwnerType());
    }

    /**
     * 判断资源是否为默认超级助手。
     * 默认超级助手统一落为真实 DIG_EMPLOYEE，且 resource_code 固定使用 {userCode}_main。
     *
     * @author qin.guoquan
     * @date 2026-05-09 150800
     * @param ssResource 资源
     * @return 是否默认超级助手
     */
    private boolean isDefaultSuperAssistantResource(SsResource ssResource) {
        return ssResource != null
            && ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(ssResource.getResourceBizType())
            && StringUtils.endsWith(ssResource.getResourceCode(), DEFAULT_SUPER_ASSISTANT_RESOURCE_CODE_SUFFIX);
    }

    /**
     * 判断资源是否为当前用户绑定的默认数字员工。
     */
    private boolean isCurrentUserBoundDefaultDigitalEmployeeResource(SsResource ssResource) {
        if (!isDefaultPersonalResource(ssResource) || ssResource.getResourceId() == null) {
            return false;
        }
        if (!ResourceBizTypeEnum.DIG_EMPLOYEE.name().equals(ssResource.getResourceBizType())) {
            return false;
        }
        Long defaultDigEmployeeId = CurrentUserHolder.getDefaultDigEmployeeId();
        return ssResource.getResourceId().equals(defaultDigEmployeeId);
    }

    /**
     * 计算 canApplyUse。复用已有 4 个判定：发布门户允许 + 非创建者 + 非黑名单 + 未授权使用 + 未在申请中。
     */
    private boolean checkCanApplyUse(SsResource ssResource) {
        if (ssResource == null) {
            return false;
        }
        if (ssResource.getPublishPortal() != null && ssResource.getPublishPortal() == 0) {
            return false;
        }
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        if (currentUserId == null) {
            return false;
        }
        if (currentUserId.equals(ssResource.getCreateBy())) {
            return false;
        }
        Long resourceId = ssResource.getResourceId();
        if (resourceId == null) {
            return false;
        }
        List<Long> resourceIds = List.of(resourceId);
        List<String> resourceBizTypes = ssResource.getResourceBizType() == null
            ? Collections.emptyList()
            : List.of(ssResource.getResourceBizType());
        if (queryCurrentUserUseBlacklistedResourceIds(resourceIds, resourceBizTypes).contains(resourceId)) {
            return false;
        }
        if (queryCurrentUserUsePermittedResourceIds(resourceIds, resourceBizTypes).contains(resourceId)) {
            return false;
        }
        if (queryCurrentUserPendingUseApplyResourceIds(resourceIds, resourceBizTypes).contains(resourceId)) {
            return false;
        }
        return true;
    }

}
