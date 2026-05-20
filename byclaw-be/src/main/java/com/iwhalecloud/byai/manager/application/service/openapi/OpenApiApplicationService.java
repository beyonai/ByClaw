package com.iwhalecloud.byai.manager.application.service.openapi;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.men.NoticeDetail;
import com.iwhalecloud.byai.manager.dto.men.Notices;
import com.iwhalecloud.byai.manager.dto.openapi.MountResourceDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.poi.util.StringUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.Date;
import java.util.List;

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
        if (StringUtil.isNotBlank(userCode)) {
            ShareBfmUser shareBfmUser = ShareCacheUtil.getShareBfmUser(userCode);
            return shareBfmUser.getUserId();
        }

        throw new BaseRuntimeException(I18nUtil.get("openapi.application.service.user.not.found", userId, userCode));
    }

    /**
     * 挂载数字员工资源
     *
     * @param mountResourceDto 资源信息
     */
    public void mountDigEmployeeResource(MountResourceDto mountResourceDto) {
        Long agentId = mountResourceDto.getAgentId();
        String relResourceCode = mountResourceDto.getRelResourceCode();

        SsResource relSsResource = ssResourceService.findByIdOrCode(null, relResourceCode);

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
}
