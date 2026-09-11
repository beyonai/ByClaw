package com.iwhalecloud.byai.manager.application.service.openapi;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeInstallResourceDTO;
import com.iwhalecloud.byai.manager.dto.men.NoticeDetail;
import com.iwhalecloud.byai.manager.dto.men.Notices;
import com.iwhalecloud.byai.manager.dto.openapi.MountResourceDto;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPermissionCheckDto;
import com.iwhalecloud.byai.manager.dto.openapi.OpenPermissionCheckResultDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
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
    private AuthApplicationService authApplicationService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

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
        result.setAllPermitted(result.getItems().stream().allMatch(this::isPermissionCheckPassed));
        return result;
    }

    /**
     * 批量校验当前登录用户是否有资源使用权限。
     *
     * @param checkDto 校验入参
     * @return 校验结果
     */
    public OpenPermissionCheckResultDto checkResourceUsePermission(OpenPermissionCheckDto checkDto) {
        OpenPermissionCheckResultDto result = new OpenPermissionCheckResultDto();
        List<OpenPermissionCheckResultDto.Item> items = resolveResourcePermissionItems(checkDto);
        if (CollectionUtils.isEmpty(items)) {
            result.setAllPermitted(false);
            return result;
        }

        result.getItems().addAll(items);
        result.setAllPermitted(result.getItems().stream().allMatch(this::isPermissionCheckPassed));
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

        DigitalEmployeeInstallResourceDTO installResourceDTO = new DigitalEmployeeInstallResourceDTO();
        installResourceDTO.setDigitalEmployeeId(agentResource.getResourceId());
        installResourceDTO.setRelIds(List.of(relSsResource.getResourceId()));
        digitalEmployeeApplicationService.installDigitalEmployeeRelResources(installResourceDTO);
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

        DigitalEmployeeInstallResourceDTO uninstallResourceDTO = new DigitalEmployeeInstallResourceDTO();
        uninstallResourceDTO.setDigitalEmployeeId(agentResource.getResourceId());
        uninstallResourceDTO.setRelIds(List.of(relSsResource.getResourceId()));
        digitalEmployeeApplicationService.uninstallDigitalEmployeeRelResources(uninstallResourceDTO);
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

    /**
     * 按资源 ID 或资源编码加载待挂载资源；编码模式支持按资源业务类型缩小匹配范围。
     */
    private SsResource loadMountResource(MountResourceDto mountResourceDto) {
        Long relResourceId = mountResourceDto == null ? null : mountResourceDto.getRelResourceId();
        String relResourceCode = mountResourceDto == null ? null : mountResourceDto.getRelResourceCode();
        String relResourceBizType = mountResourceDto == null ? null : mountResourceDto.getRelResourceBizType();
        if (relResourceId == null && StringUtils.isBlank(relResourceCode)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.mount.rel.resource.code.not.empty"));
        }
        if (relResourceId != null && StringUtils.isNotBlank(relResourceCode)) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.resource.id.code.exclusive"));
        }
        if (relResourceId != null) {
            return ssResourceService.findById(relResourceId);
        }

        validateCodeQueryParams(relResourceCode);
        List<SsResource> resources = findResourceCandidates(relResourceCode, relResourceBizType);
        if (CollectionUtils.isEmpty(resources)) {
            return null;
        }
        return resolveUniqueMountResource(resources, relResourceCode, relResourceBizType);
    }

    private List<SsResource> findResourceCandidates(String resourceCode, String resourceBizType) {
        if (StringUtils.isNotBlank(resourceBizType)) {
            return ssResourceService.findByCodeAndBizType(resourceCode, resourceBizType);
        }
        return ssResourceService.findByCode(resourceCode);
    }

    private SsResource resolveUniqueMountResource(List<SsResource> resources, String resourceCode,
        String resourceBizType) {
        if (CollectionUtils.isEmpty(resources)) {
            return null;
        }
        if (resources.size() == 1) {
            return resources.get(0);
        }
        logger.warn(
            "OpenAPI挂载资源编码匹配到多条有效资源，请改传resourceId。resourceCode={}, resourceBizType={}, matchedResourceIds={}",
            resourceCode, resourceBizType, resources.stream().map(SsResource::getResourceId).toList());
        throw new BaseRuntimeException(I18nUtil.get("openapi.resource.code.not.unique"));
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

    private List<OpenPermissionCheckResultDto.Item> resolveResourcePermissionItems(OpenPermissionCheckDto checkDto) {
        if (checkDto == null) {
            return Collections.emptyList();
        }
        boolean hasIdMode = CollectionUtils.isNotEmpty(checkDto.getResourceIds());
        boolean hasResourceRefs = CollectionUtils.isNotEmpty(checkDto.getResources());
        boolean hasResourceCodes = CollectionUtils.isNotEmpty(checkDto.getResourceCodes());
        boolean hasCodeMode = hasResourceRefs || hasResourceCodes;
        if (hasIdMode && hasCodeMode) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.resource.id.code.exclusive"));
        }
        if (hasResourceRefs && hasResourceCodes) {
            throw new BaseRuntimeException(I18nUtil.get("openapi.resource.code.mode.exclusive"));
        }

        List<OpenPermissionCheckResultDto.Item> items = new ArrayList<>();
        if (hasIdMode) {
            for (Long resourceId : checkDto.getResourceIds()) {
                SsResource resource = ssResourceService.findById(resourceId);
                items.add(buildPermissionItem(resource, resource != null
                    && authApplicationService.hasResourceUsePermission(resource), null));
            }
            return items;
        }

        for (OpenPermissionCheckDto.ResourceCodeRef ref : buildResourceCodeRefs(checkDto)) {
            String resourceCode = ref.getResourceCode();
            String resourceBizType = ref.getResourceBizType();
            String invalidMessage = getCodeQueryInvalidMessage(resourceCode);
            if (StringUtils.isNotBlank(invalidMessage)) {
                items.add(buildInvalidPermissionItem(resourceCode, resourceBizType, invalidMessage));
                continue;
            }

            List<SsResource> resources = findResourceCandidates(resourceCode, resourceBizType);
            if (CollectionUtils.isEmpty(resources)) {
                items.add(buildInvalidPermissionItem(resourceCode, resourceBizType,
                    I18nUtil.get("resource.not.found")));
                continue;
            }
            if (resources.size() > 1) {
                items.add(buildInvalidPermissionItem(resourceCode, resourceBizType,
                    I18nUtil.get("openapi.resource.code.not.unique")));
                continue;
            }
            SsResource resource = resources.get(0);
            items.add(buildPermissionItem(resource,
                authApplicationService.hasResourceUsePermission(resource), null));
        }
        return items;
    }

    private List<OpenPermissionCheckDto.ResourceCodeRef> buildResourceCodeRefs(OpenPermissionCheckDto checkDto) {
        if (CollectionUtils.isNotEmpty(checkDto.getResources())) {
            return checkDto.getResources();
        }
        if (CollectionUtils.isEmpty(checkDto.getResourceCodes())) {
            return Collections.emptyList();
        }
        List<OpenPermissionCheckDto.ResourceCodeRef> refs = new ArrayList<>();
        for (String resourceCode : checkDto.getResourceCodes()) {
            OpenPermissionCheckDto.ResourceCodeRef ref = new OpenPermissionCheckDto.ResourceCodeRef();
            ref.setResourceCode(resourceCode);
            ref.setResourceBizType(checkDto.getResourceBizType());
            refs.add(ref);
        }
        return refs;
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

    private OpenPermissionCheckResultDto.Item buildInvalidPermissionItem(String resourceCode, String resourceBizType,
        String message) {
        OpenPermissionCheckResultDto.Item item = new OpenPermissionCheckResultDto.Item();
        item.setResourceCode(resourceCode);
        item.setResourceBizType(resourceBizType);
        item.setExists(false);
        item.setHasPermission(false);
        item.setMessage(message);
        return item;
    }

    private boolean isPermissionCheckPassed(OpenPermissionCheckResultDto.Item item) {
        return item != null && item.isHasPermission() && item.isExists();
    }

    private boolean isDigitalEmployee(SsResource resource) {
        return resource != null
            && StringUtils.equals(ResourceBizTypeEnum.DIG_EMPLOYEE.name(), resource.getResourceBizType());
    }

    private void validateCodeQueryParams(String resourceCode) {
        String invalidMessage = getCodeQueryInvalidMessage(resourceCode);
        if (StringUtils.isNotBlank(invalidMessage)) {
            throw new BaseRuntimeException(invalidMessage);
        }
    }

    private String getCodeQueryInvalidMessage(String resourceCode) {
        if (StringUtils.isBlank(resourceCode)) {
            return I18nUtil.get("openapi.resource.code.not.empty");
        }
        return null;
    }
}
