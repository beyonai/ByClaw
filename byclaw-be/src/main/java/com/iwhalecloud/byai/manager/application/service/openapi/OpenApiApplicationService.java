package com.iwhalecloud.byai.manager.application.service.openapi;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.men.NoticeDetail;
import com.iwhalecloud.byai.manager.dto.men.Notices;
import com.iwhalecloud.byai.manager.dto.openapi.MountResourceDto;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPermissionCheckDto;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPermissionCheckResultDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.ArrayList;
import java.util.Collections;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.List;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;

/**
 * @author he.duming
 * @date 2026-05-08 20:32:06
 * @description TODO
 */
@Service
public class OpenApiApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(OpenApiApplicationService.class);

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private NotificationService notificationService;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private DingtalkRobotRegistryService dingtalkRobotRegistryService;

    @Autowired
    private DigEmployeeChangeEventPublisher digEmployeeChangeEventPublisher;

    @Autowired
    private AuthApplicationService authApplicationService;

    /**
     * 开放通知
     *
     * @param notices 通知信息
     */
    public void createNotice(Notices notices) {
        List<NoticeDetail> noticeDetails = notices.getNoticeDetails();
        for (NoticeDetail noticeDetail : noticeDetails) {
            ByaiNotification notification = new ByaiNotification();
            notification.setId(sequenceService.nextVal());
            notification.setTitle(noticeDetail.getTitle());
            notification.setContent(noticeDetail.getContent());
            notification.setSenderId(this.getUserId(noticeDetail.getSenderId(), noticeDetail.getSendUserCode()));
            notification.setTargetId(this.getUserId(noticeDetail.getTargetId(), noticeDetail.getTargetUserCode()));
            // 设置业务类型为1（业务通知）
            notification.setBizType((short) 1);
            notification.setCreateTime(new Date());
            notification.setIsRead("0");
            notification.setIsDeleted("0");
            notificationService.save(notification, true);
        }
    }

    /***
     * 获取用户标识
     *
     * @param userId 用户标识
     * @param userCode 用户编码
     * @return Long
     */
    private Long getUserId(Long userId, String userCode) {

        // 优先用用户标识
        if (userId != null) {
            return userId;
        }

        // 根据用户编码查找
        if (StringUtils.isNotBlank(userCode)) {
            ShareBfmUser shareBfmUser = ShareCacheUtil.getShareBfmUser(userCode);
            return shareBfmUser.getUserId();
        }

        throw new BaseRuntimeException(I18nUtil.get("openapi.application.service.user.not.found", userId, userCode));
    }

    /**
     * 批量校验当前登录用户是否有数字员工管理权限。
     *
     * @param checkDto 校验入参
     * @return 校验结果
     */
    public OpenPermissionCheckResultDto checkDigEmployeeManagePermission(OpenPermissionCheckDto checkDto) {
        List<Long> agentIds = checkDto == null ? Collections.emptyList() : checkDto.getAgentIds();
        OpenPermissionCheckResultDto result = new OpenPermissionCheckResultDto();
        if (CollectionUtils.isEmpty(agentIds)) {
            result.setAllPermitted(false);
            return result;
        }

        for (Long agentId : agentIds) {
            SsResource agent = ssResourceService.findById(agentId);
            result.getItems().add(buildPermissionItem(agent, authApplicationService.hasResourceManagePermission(agent),
                isDigitalEmployee(agent) ? null : I18nUtil.get("openapi.mount.agent.not.digital.employee")));
        }
        result.setAllPermitted(result.getItems().stream().allMatch(item -> item.isExists() && item.isHasPermission()));
        return result;
    }

    /**
     * 批量校验当前登录用户是否有资源使用权限。
     *
     * @param checkDto 校验入参
     * @return 校验结果
     */
    public OpenPermissionCheckResultDto checkResourceUsePermission(OpenPermissionCheckDto checkDto) {
        List<SsResource> resources = resolveResources(checkDto);
        OpenPermissionCheckResultDto result = new OpenPermissionCheckResultDto();
        if (CollectionUtils.isEmpty(resources)) {
            result.setAllPermitted(false);
            return result;
        }

        for (SsResource resource : resources) {
            result.getItems().add(buildPermissionItem(resource, authApplicationService.hasResourceUsePermission(resource),
                null));
        }
        result.setAllPermitted(result.getItems().stream().allMatch(item -> item.isExists() && item.isHasPermission()));
        return result;
    }

    /**
     * 挂载数字员工资源
     *
     * @param mountResourceDto 资源信息
     */
    public void mountDigEmployeeResource(MountResourceDto mountResourceDto) {
        SsResource agentResource = loadAndValidateMountAgent(mountResourceDto);
        SsResource relSsResource = loadAndValidateMountResource(mountResourceDto);
        validateMountPermission(agentResource, relSsResource);
        Long agentId = agentResource.getResourceId();
        Long relResourceId = relSsResource.getResourceId();
        List<SsResourceRelDetail> resourceRelDetails = ssResourceRelDetailService.find(agentId, relResourceId);
        // 是否已经挂载过
        if (ListUtil.isNotEmpty(resourceRelDetails)) {
            return;
        }

        SsResourceRelDetail ssResourceRelDetail = new SsResourceRelDetail();
        ssResourceRelDetail.setResourceRelDetailId(sequenceService.nextVal());
        ssResourceRelDetail.setResourceId(agentId);
        ssResourceRelDetail.setRelResourceId(relResourceId);
        ssResourceRelDetail.setRelStatus(1);
        ssResourceRelDetail.setCreateTime(new Date());
        ssResourceRelDetail.setCreateBy(CurrentUserHolder.getCurrentUserId());
        ssResourceRelDetail.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResourceRelDetailService.save(ssResourceRelDetail);

        try {
            dingtalkRobotRegistryService.refreshRobotClientsForResource(agentId);
        }
        catch (Exception e) {
            logger.warn("Refresh DingTalk robot clients after update failed. resourceId={}", agentId, e);
        }

        digEmployeeChangeEventPublisher.publishAfterCommitOrNow(DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED,
            agentId);

    }

    /**
     * 取消挂载数字员工资源
     *
     * @param mountResourceDto 资源信息
     */
    public void unMountDigEmployeeResource(MountResourceDto mountResourceDto) {

        SsResource agentResource = loadAndValidateMountAgent(mountResourceDto);
        SsResource relSsResource = loadMountResource(mountResourceDto);

        // 如果没有资源信息，返回
        if (relSsResource == null) {
            return;
        }
        if (!authApplicationService.hasResourceManagePermission(agentResource)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.agent.no.manage.permission",
                agentResource.getResourceName()));
        }

        // 删除挂载的资源
        LambdaQueryWrapper<SsResourceRelDetail> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceRelDetail::getResourceId, agentResource.getResourceId());
        queryWrapper.eq(SsResourceRelDetail::getRelResourceId, relSsResource.getResourceId());
        ssResourceRelDetailService.remove(queryWrapper);

        try {
            dingtalkRobotRegistryService.refreshRobotClientsForResource(agentResource.getResourceId());
        }
        catch (Exception e) {
            logger.warn("Refresh DingTalk robot clients after update failed. resourceId={}", agentResource.getResourceId(),
                e);
        }

        digEmployeeChangeEventPublisher.publishAfterCommitOrNow(DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED,
            agentResource.getResourceId());
    }

    private SsResource loadAndValidateMountAgent(MountResourceDto mountResourceDto) {
        Long agentId = mountResourceDto == null ? null : mountResourceDto.getAgentId();
        if (agentId == null) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.agent.id.not.empty"));
        }
        SsResource agentResource = ssResourceService.findById(agentId);
        if (agentResource == null) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.agent.not.found", agentId));
        }
        if (!isDigitalEmployee(agentResource)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.agent.not.digital.employee"));
        }
        return agentResource;
    }

    private SsResource loadAndValidateMountResource(MountResourceDto mountResourceDto) {
        SsResource relSsResource = loadMountResource(mountResourceDto);
        if (relSsResource == null) {
            Object resourceKey = mountResourceDto == null || mountResourceDto.getRelResourceId() == null
                ? mountResourceDto == null ? null : mountResourceDto.getRelResourceCode()
                : mountResourceDto.getRelResourceId();
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.rel.resource.not.found", resourceKey));
        }
        return relSsResource;
    }

    private SsResource loadMountResource(MountResourceDto mountResourceDto) {
        Long relResourceId = mountResourceDto == null ? null : mountResourceDto.getRelResourceId();
        String relResourceCode = mountResourceDto == null ? null : mountResourceDto.getRelResourceCode();
        if (relResourceId == null && StringUtils.isBlank(relResourceCode)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.rel.resource.code.not.empty"));
        }
        return ssResourceService.findByIdOrCode(relResourceId, relResourceCode);
    }

    private void validateMountPermission(SsResource agentResource, SsResource relSsResource) {
        if (!authApplicationService.hasResourceManagePermission(agentResource)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.agent.no.manage.permission",
                agentResource.getResourceName()));
        }
        if (!authApplicationService.hasResourceUsePermission(relSsResource)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.rel.resource.no.use.permission",
                relSsResource.getResourceName()));
        }
    }

    private List<SsResource> resolveResources(OpenPermissionCheckDto checkDto) {
        if (checkDto == null) {
            return Collections.emptyList();
        }
        List<SsResource> resources = new ArrayList<>();
        if (CollectionUtils.isNotEmpty(checkDto.getResourceIds())) {
            for (Long resourceId : checkDto.getResourceIds()) {
                resources.add(ssResourceService.findById(resourceId));
            }
        }
        if (CollectionUtils.isNotEmpty(checkDto.getResourceCodes())) {
            for (String resourceCode : checkDto.getResourceCodes()) {
                resources.add(ssResourceService.findByIdOrCode(null, resourceCode));
            }
        }
        return resources;
    }

    private OpenPermissionCheckResultDto.Item buildPermissionItem(SsResource resource, boolean hasPermission,
        String invalidMessage) {
        OpenPermissionCheckResultDto.Item item = new OpenPermissionCheckResultDto.Item();
        if (resource == null) {
            item.setExists(false);
            item.setHasPermission(false);
            item.setMessage(I18nUtil.get("resource.not.found"));
            return item;
        }
        item.setResourceId(resource.getResourceId());
        item.setResourceCode(resource.getResourceCode());
        item.setResourceName(resource.getResourceName());
        item.setResourceBizType(resource.getResourceBizType());
        item.setExists(true);
        item.setHasPermission(StringUtils.isBlank(invalidMessage) && hasPermission);
        item.setMessage(StringUtils.isNotBlank(invalidMessage) ? invalidMessage
            : hasPermission ? null : I18nUtil.get("user.permission.nopermission"));
        return item;
    }

    private boolean isDigitalEmployee(SsResource resource) {
        return resource != null
            && StringUtils.equals(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), resource.getResourceBizType());
    }
}
