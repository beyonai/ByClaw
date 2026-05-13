package com.iwhalecloud.byai.manager.interfaces.controller.auth;

import com.iwhalecloud.byai.manager.qo.auth.DigitalEmployeeAuthQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceAuthQo;
import com.iwhalecloud.byai.manager.vo.auth.DigitalEmployeeAuthVo;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.domain.resource.request.DigEmployeeRelResourceQo;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.common.page.PageInfo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.qo.resource.DigitalEmployeeQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthDetailQo;
import com.iwhalecloud.byai.manager.qo.auth.AuthManQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyApproveQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceUseApplyQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberQueryQo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceMemberSettingQo;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.auth.AuthManOrgDTO;
import com.iwhalecloud.byai.manager.dto.auth.AuthRedBlackDTO;
import com.iwhalecloud.byai.manager.dto.auth.PriviledgeQo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.auth.FixedEntryOperationCapabilityVo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceOperationPermissionsVo;
import com.iwhalecloud.byai.manager.qo.auth.ResourceOperationPermissionsQo;
import com.iwhalecloud.byai.manager.vo.auth.ResourceUseApplyItemVo;
import com.iwhalecloud.byai.manager.vo.resource.DigitalEmployeeVo;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.vo.auth.ResourceMemberQueryResultVo;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;

import java.util.List;

/**
 * @author he.duming
 * @date 2025-04-25 10:51:40
 * @description TODO
 */

@RestController
@RequestMapping("/auth/privilegeGrant")
public class AuthController {

    private static final Logger logger = LoggerFactory.getLogger(AuthController.class);

    private static final String ADMIN_VIP_USER_CODE = "adminvip";

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    /**
     * 组织-岗位-人员-数据员工授权管理明细
     *
     * @param qo 数字员工授权查询对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/listDigitalEmployeeAuth", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<DigitalEmployeeAuthVo>> listDigitalEmployeeAuth(
        @RequestBody DigitalEmployeeAuthQo qo) {
        PageInfo<DigitalEmployeeAuthVo> res = resourceAuthApplicationService.listDigitalEmployeeAuthByUser(qo);
        return ResponseUtil.successResponse(res);
    }

    /**
     * 使用授权
     *
     * @param authRedBlackDTO 红黑名单授权对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "使用授权")
    @RequestMapping(value = "/availableUseAuth", method = RequestMethod.POST)
    public ResponseUtil availableUseAuth(@RequestBody AuthRedBlackDTO authRedBlackDTO) {
        logger.info("使用管理入参数{}", JSON.toJSONString(authRedBlackDTO));
        authRedBlackDTO.setGrantType(GrantType.FORCE_USE);

        // 验证资源是否允许进行授权操作
        validateResourceForAuthorization(authRedBlackDTO.getGrantObjId());

        authApplicationService.handleAuth(authRedBlackDTO);
        return ResponseUtil.success(I18nUtil.get("auth.available.use.success"));
    }

    /**
     * 分享授权
     *
     * @param authRedBlackDTO 红黑名单授权对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "分享授权")
    @RequestMapping(value = "/shareUseAuth", method = RequestMethod.POST)
    public ResponseUtil shareUseAuth(@RequestBody AuthRedBlackDTO authRedBlackDTO) {
        logger.info("前台分享授权入参数{}", JSON.toJSONString(authRedBlackDTO));
        authRedBlackDTO.setGrantType(GrantType.SHARE_USE);

        // 验证资源是否允许进行授权操作
        validateResourceForAuthorization(authRedBlackDTO.getGrantObjId());

        authApplicationService.handleAuth(authRedBlackDTO);
        return ResponseUtil.success(I18nUtil.get("auth.share.use.success"));
    }

    /**
     * 获取权限列表
     *
     * @param priviledgeQo
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getAuthList", method = RequestMethod.POST)
    public ResponseUtil getAuthList(@RequestBody PriviledgeQo priviledgeQo) {
        return ResponseUtil.successResponse(I18nUtil.get("auth.list.query.success"),
            authApplicationService.getAuthList(priviledgeQo));
    }

    /**
     * 校验当前用户是否有权限在企业 tab 下创建工具类资源。 满足以下任一条件即可： 1. 当前企业管理员（业务管理）； 2. 当前组织管理员； 3. 平台管理员； 4. userCode 为 adminvip。
     */
    @RequestMapping(value = "/checkEnterpriseToolCreatePermission", method = RequestMethod.GET)
    public ResponseUtil<Boolean> checkEnterpriseToolCreatePermission() {
        boolean hasPermission = CurrentUserHolder.isBusinessAdmin() || CurrentUserHolder.isOrganizationAdmin()
            || CurrentUserHolder.isPlatformManager()
            || ADMIN_VIP_USER_CODE.equalsIgnoreCase(CurrentUserHolder.getCurrentUserCode());
        logger.info("校验企业tab工具类创建权限, userId={}, userCode={}, hasPermission={}", CurrentUserHolder.getCurrentUserId(),
            CurrentUserHolder.getCurrentUserCode(), hasPermission);
        return ResponseUtil.successResponse(I18nUtil.get("auth.enterprise.tool.create.permission.query.success"),
            hasPermission);
    }

    /**
     * 查询资源中心固定入口按钮能力。
     *
     * @author qin.guoquan
     * @date 2026-04-24 19:08:00
     */
    @RequestMapping(value = "/queryFixedEntryOperationCapability", method = RequestMethod.GET)
    public ResponseUtil<FixedEntryOperationCapabilityVo> queryFixedEntryOperationCapability() {
        return ResponseUtil.successResponse(I18nUtil.get("auth.fixed.entry.capability.query.success"),
            authApplicationService.queryFixedEntryOperationCapability());
    }

    /**
     * 查询当前用户对指定资源的操作权限（编辑/管理授权/使用授权/注销/使用申请/使用审核 + 数字员工的设为默认）。 资源不存在时抛 BaseException。
     *
     * @author qin.guoquan
     * @date 2026-05-06
     */
    @PostMapping("/queryResourceOperationPermissions")
    public ResponseUtil<ResourceOperationPermissionsVo> queryResourceOperationPermissions(
        @Validated @RequestBody ResourceOperationPermissionsQo qo) {
        ResourceOperationPermissionsVo vo = authApplicationService
            .queryResourceOperationPermissions(qo.getResourceId());
        return ResponseUtil.successResponse(I18nUtil.get("auth.resource.permission.query.success"), vo);
    }

    /**
     * 提交资源使用申请。
     *
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    @RequestMapping(value = "/applyUse", method = RequestMethod.POST)
    public ResponseUtil applyUse(@Validated @RequestBody ResourceUseApplyQo qo) {
        authApplicationService.applyUse(qo);
        return ResponseUtil.success(I18nUtil.get("auth.use.apply.submit.success"));
    }

    /**
     * 查询资源待审核使用申请列表。
     *
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    @RequestMapping(value = "/queryUseApplyList", method = RequestMethod.POST)
    public ResponseUtil<List<ResourceUseApplyItemVo>> queryUseApplyList(@Validated @RequestBody ResourceUseApplyQo qo) {
        return ResponseUtil.successResponse(I18nUtil.get("auth.use.apply.list.query.success"),
            authApplicationService.queryUseApplyList(qo));
    }

    /**
     * 审核通过资源使用申请。
     *
     * @author qin.guoquan
     * @date 2026-04-25 16:20:00
     */
    @RequestMapping(value = "/approveUseApply", method = RequestMethod.POST)
    public ResponseUtil approveUseApply(@Validated @RequestBody ResourceUseApplyApproveQo qo) {
        authApplicationService.approveUseApply(qo);
        return ResponseUtil.success(I18nUtil.get("auth.use.apply.approve.success"));
    }

    /**
     * 拒绝资源使用申请。
     *
     * @author qin.guoquan
     * @date 2026-04-27 00:00:00
     */
    @RequestMapping(value = "/rejectUseApply", method = RequestMethod.POST)
    public ResponseUtil rejectUseApply(@Validated @RequestBody ResourceUseApplyApproveQo qo) {
        authApplicationService.rejectUseApply(qo);
        return ResponseUtil.success(I18nUtil.get("auth.use.apply.reject.success"));
    }

    /**
     * 查询个人归属数字员工列表。 查询范围： 1. 我创建的； 2. 我管理的； 3. 我使用的。 返回结构与 /digitalEmployeeController/queryAllDigitalEmployeeList 一致。
     */
    @RequestMapping(value = "/queryPersonalDigitalEmployeeList", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<DigitalEmployeeVo>> queryPersonalDigitalEmployeeList(
        @RequestBody DigitalEmployeeQo employeeQo) {
        PageInfo<DigitalEmployeeVo> pageVO = digitalEmployeeApplicationService
            .queryPersonalDigitalEmployeeList(employeeQo);
        return ResponseUtil.successResponse(I18nUtil.get("auth.personal.digemployee.list.query.success"), pageVO);
    }

    /**
     * 管理授权 新增有组织权限的才能授权
     *
     * @param authRedBlackDTO 红黑名单授权对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "管理授权")
    @RequestMapping(value = "/allowManageAuth", method = RequestMethod.POST)
    public ResponseUtil allowManageAuth(@RequestBody AuthRedBlackDTO authRedBlackDTO) {
        logger.info("授权管理入参数{}", JSON.toJSONString(authRedBlackDTO));
        if (!(CurrentUserHolder.isPlatformManager()
            || organizationService.isOrganizationManManager(authRedBlackDTO.getOrgId()))) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.permission.nopermission"));
        }

        // 验证资源是否允许进行授权操作
        validateResourceForAuthorization(authRedBlackDTO.getGrantObjId());

        authRedBlackDTO.setGrantType(GrantType.ALLOW_MANAGE);
        authApplicationService.handleAuth(authRedBlackDTO);
        return ResponseUtil.success(I18nUtil.get("auth.allow.manage.success"));
    }

    /**
     * 归属授权，只有红名单
     *
     * @param authRedBlackDTO 红黑名单授权对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "归属授权")
    @RequestMapping(value = "/ownerAuth", method = RequestMethod.POST)
    public ResponseUtil ownerAuth(@RequestBody AuthRedBlackDTO authRedBlackDTO) {
        authRedBlackDTO.setGrantType(GrantType.OWNER);
        logger.info("归属授权入参数{}", JSON.toJSONString(authRedBlackDTO));

        // 验证资源是否允许进行授权操作
        validateResourceForAuthorization(authRedBlackDTO.getGrantObjId());

        authApplicationService.handleAuth(authRedBlackDTO);
        return ResponseUtil.success(I18nUtil.get("auth.owner.success"));
    }

    /**
     * 获取授权详情
     *
     * @param authDetailQo 授权对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/listAuthDetail", method = RequestMethod.POST)
    public ResponseUtil listAuthDetail(@Validated @RequestBody AuthDetailQo authDetailQo) {
        return authApplicationService.listAuthDetail(authDetailQo);
    }

    /**
     * 分组获取授权详情
     *
     * @param authDetailQo 授权对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/listAuthDetailByGroup", method = RequestMethod.POST)
    public ResponseUtil listAuthDetailByGroup(@Validated @RequestBody AuthDetailQo authDetailQo) {
        return authApplicationService.listAuthDetailByGroup(authDetailQo);
    }

    /**
     * 查询资源的管理人员和使用人员
     *
     * @param queryQo 查询条件
     * @return 成员信息
     */
    @RequestMapping(value = "/queryResourceMembers", method = RequestMethod.POST)
    public ResponseUtil<ResourceMemberQueryResultVo> queryResourceMembers(
        @Validated @RequestBody ResourceMemberQueryQo queryQo) {
        return ResponseUtil.successResponse(I18nUtil.get("auth.resource.members.query.success"),
            authApplicationService.queryResourceMembers(queryQo));
    }

    /**
     * 设置资源管理人员。 该接口用于覆盖式维护某个资源的管理红黑名单。 前端传入的名单会和历史授权做对比，新增、更新、移除都会自动完成。
     *
     * @param settingQo 设置入参
     * @return 处理结果
     */
    @ManageLogAnnotation(name = "授权管理", description = "设置资源管理人员")
    @RequestMapping(value = "/setResourceManagers", method = RequestMethod.POST)
    public ResponseUtil setResourceManagers(@Validated @RequestBody ResourceMemberSettingQo settingQo) {
        // 资源是否允许授权，沿用现有授权控制规则。
        validateResourceForAuthorization(settingQo.getResourceId());
        authApplicationService.setResourceManagers(settingQo);
        return ResponseUtil.success(I18nUtil.get("auth.resource.managers.set.success"));
    }

    /**
     * 设置资源使用人员。 该接口用于覆盖式维护某个资源的使用红黑名单。 当前按系统既有口径落为 FORCE_USE，表示后台直接授权的可使用对象。
     *
     * @param settingQo 设置入参
     * @return 处理结果
     */
    @ManageLogAnnotation(name = "授权管理", description = "设置资源使用人员")
    @RequestMapping(value = "/setResourceUsers", method = RequestMethod.POST)
    public ResponseUtil setResourceUsers(@Validated @RequestBody ResourceMemberSettingQo settingQo) {
        // 资源是否允许授权，沿用现有授权控制规则。
        validateResourceForAuthorization(settingQo.getResourceId());
        authApplicationService.setResourceUsers(settingQo);
        return ResponseUtil.success(I18nUtil.get("auth.resource.users.set.success"));
    }

    /**
     * 组织使用授权
     *
     * @param authManOrgDTO 红黑名单授权对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "组织使用授权")
    @RequestMapping(value = "/mangerOrgUseAuth", method = RequestMethod.POST)
    public ResponseUtil mangerOrgAuth(@RequestBody AuthManOrgDTO authManOrgDTO) {
        logger.info("授权管理组织使用入参数{}", JSON.toJSONString(authManOrgDTO));

        authManOrgDTO.setGrantType(GrantType.AVAILABLE_USE);
        authApplicationService.mangerOrgUseAuth(authManOrgDTO);

        return ResponseUtil.success(I18nUtil.get("auth.org.use.success"));
    }

    /**
     * 获取组织管理授权详情
     *
     * @param authManQo 授权对象
     * @return ResponseUtil
     */
    @RequestMapping(value = "/listMangerOrgUseDetail", method = RequestMethod.POST)
    public ResponseUtil listMangerOrgUseDetail(@Validated @RequestBody AuthManQo authManQo) {
        return authApplicationService.listMangerOrgUseDetail(authManQo);
    }

    /**
     * 移除分享权限
     *
     * @param priviledgeGrant 删除权限
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "移除分享权限")
    @RequestMapping(value = "/delPriv", method = RequestMethod.POST)
    ResponseUtil delShare(@RequestBody PrivilegeGrant priviledgeGrant) {
        return authApplicationService.delShare(priviledgeGrant);
    }

    /**
     * 检查当前用户是否为管理）
     *
     * @return ResponseUtil 响应结果，包含用户是否为平台管理员、运营人员或组织管理员的判断结果
     */
    @RequestMapping(value = "/isAdmin", method = RequestMethod.GET)
    ResponseUtil isAdmin() {
        // 判断当前用户是否为平台管理员/运营人员或组织管理员
        return ResponseUtil.successResponse(I18nUtil.get("auth.admin.status.query.success"),
            CurrentUserHolder.isPlatformAdminOrOperator() || CurrentUserHolder.isOrganizationAdmin());
    }

    /**
     * 验证资源是否允许进行授权操作 检查资源的publish_portal字段，给果为0则不允许授权操作
     *
     * @param resourceId 资源ID
     * @throws BaseException 当资源不允许授权时抛出异常
     */
    private void validateResourceForAuthorization(Long resourceId) {
        if (resourceId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.id.empty"));
        }

        // 查询资源信息
        SsResource resource = ssResourceService.findById(resourceId);
        if (resource == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("resource.not.found"));
        }

        // 检查publish_portal字段，给果为0则表示不发布到业务门户的数字员工，不能进行授权操作
        if (resource.getPublishPortal() != null && resource.getPublishPortal() == 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("resource.not.allow.auth", resource.getResourceName()));
        }
    }

    /**
     * 批量处理多种授权类型 根据redList和blackList中每个授权对象的grantType进行分组，为每个授权类型分别调用handleAuth
     *
     * @param authRedBlackDTO 红黑名单授权对象，redList和blackList中的AuthDTO可以包含不同的grantType
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "授权管理", description = "批量授权处理")
    @RequestMapping(value = "/batchHandleAuth", method = RequestMethod.POST)
    public ResponseUtil batchHandleAuth(@RequestBody AuthRedBlackDTO authRedBlackDTO) {
        logger.info("批量授权处理入参数{}", JSON.toJSONString(authRedBlackDTO));

        // 验证资源是否允许进行授权操作
        validateResourceForAuthorization(authRedBlackDTO.getGrantObjId());
        authApplicationService.batchHandleAuth(authRedBlackDTO);
        return ResponseUtil.success(I18nUtil.get("auth.batch.handle.success"));

    }

    /**
     * 查询用户可使用的资源权限列表
     *
     * @return 返回分页的资源权限信息列表
     */
    @RequestMapping(value = "/listResourceUseAuth", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<ResourceAuthVo>> listResourceUseAuth(
        @RequestBody ResourceUseAuthQo resourceUseAuthQo) {

        // 补齐个人默认资源 / 企业资源全量查询这类后端控制的查询口径。
        enrichResourceListScope(resourceUseAuthQo);

        PageInfo<ResourceAuthVo> pageVO = resourceAuthApplicationService.listResourceAuth(resourceUseAuthQo);

        return ResponseUtil.successResponse(I18nUtil.get("auth.resource.use.list.query.success"), pageVO);
    }

    /**
     * 查询数字员工关联的资源列表。 返回结构与 listResourceUseAuth 一致，但查询来源为数字员工与资源的关联关系。 当前固定返回：
     * KG_DOC、KG_QA、OBJECT、VIEW、TOOLKIT、MCP、AGENT。
     */
    @PostMapping("/queryDigEmployeeRelResourceAuth")
    public ResponseUtil<PageInfo<ResourceAuthVo>> queryDigEmployeeRelResourceAuth(
        @RequestBody DigEmployeeRelResourceQo qo) {
        PageInfo<ResourceAuthVo> pageVO = resourceAuthApplicationService.listDigitalEmployeeRelResourceAuth(qo);
        return ResponseUtil.successResponse(I18nUtil.get("auth.digemployee.rel.resource.list.query.success"), pageVO);
    }

    /**
     * 补齐资源列表范围： 1. 个人知识库 / 个人数字员工只额外返回当前用户绑定的默认资源； 2. 企业知识库 / 工具 / 对象 / 视图按平台全部企业资源查询。
     */
    private void enrichResourceListScope(ResourceUseAuthQo resourceUseAuthQo) {
        if (resourceUseAuthQo == null || CollectionUtils.isEmpty(resourceUseAuthQo.getResourceBizTypeList())) {
            return;
        }
        boolean hasKnowledgeBizType = resourceUseAuthQo.getResourceBizTypeList().stream()
            .filter(StringUtils::isNotBlank).anyMatch(this::isKnowledgeBizType);
        boolean hasDigEmployeeBizType = resourceUseAuthQo.getResourceBizTypeList().stream()
            .filter(StringUtils::isNotBlank)
            .anyMatch(resourceBizType -> StringUtils.equals(resourceBizType, "DIG_EMPLOYEE"));
        boolean hasEnterpriseAllResourceBizType = resourceUseAuthQo.getResourceBizTypeList().stream()
            .filter(StringUtils::isNotBlank).anyMatch(this::isEnterpriseAllResourceBizType);

        if (StringUtils.equals(resourceUseAuthQo.getOwnerType(), OwnerType.PERSONAL)) {
            boolean shouldIncludeDefault = hasKnowledgeBizType || hasDigEmployeeBizType;
            resourceUseAuthQo.setIncludeDefaultOwnerType(shouldIncludeDefault);
            if (hasKnowledgeBizType) {
                resourceUseAuthQo.setDefaultPersonalResourceId(CurrentUserHolder.getSessionDatasetId());
            }
            else if (hasDigEmployeeBizType) {
                resourceUseAuthQo.setDefaultPersonalResourceId(CurrentUserHolder.getDefaultDigEmployeeId());
            }
            return;
        }

        if (StringUtils.equals(resourceUseAuthQo.getOwnerType(), OwnerType.ENTERPRISE)
            && hasEnterpriseAllResourceBizType) {
            resourceUseAuthQo.setIncludeAllEnterpriseOwnerType(true);
        }
    }

    private boolean isKnowledgeBizType(String resourceBizType) {
        return StringUtils.startsWithIgnoreCase(resourceBizType, "KG_");
    }

    private boolean isEnterpriseAllResourceBizType(String resourceBizType) {
        return isKnowledgeBizType(resourceBizType)
            || StringUtils.equalsAny(resourceBizType, "AGENT", "MCP", "TOOLKIT", "OBJECT", "VIEW");
    }

    @RequestMapping(value = "/listResource", method = RequestMethod.POST)
    public ResponseUtil<PageInfo<ResourceAuthVo>> listResource(@RequestBody ResourceAuthQo resourceAuthQo) {
        PageInfo<ResourceAuthVo> pageInfo = resourceAuthApplicationService.listResource(resourceAuthQo);
        return ResponseUtil.successResponse(I18nUtil.get("auth.resource.list.query.success"), pageInfo);
    }

}
