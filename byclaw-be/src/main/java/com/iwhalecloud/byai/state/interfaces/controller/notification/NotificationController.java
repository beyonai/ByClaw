package com.iwhalecloud.byai.state.interfaces.controller.notification;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.notification.NotificationManageDto;
import com.iwhalecloud.byai.manager.dto.notification.NotificationQueryDto;
import com.iwhalecloud.byai.manager.dto.notification.NotificationReadDto;
import com.iwhalecloud.byai.manager.entity.notification.ByaiNotification;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.notification.NotificationVO;
import com.iwhalecloud.byai.state.domain.notification.service.NotificationService;
import jakarta.validation.Valid;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 通知类
 */
@RestController
@RequestMapping("/notification")
public class NotificationController {

    private static final Logger logger = LoggerFactory.getLogger(NotificationController.class);

    @Autowired
    private NotificationService notificationService;

    /**
     * 当前用户分页查询站内通知。
     *
     * <p>接收者始终取登录上下文，忽略客户端传入的 targetId，避免越权读取其他用户通知。</p>
     */
    @PostMapping("/getNotificationListByPage")
    public ResponseUtil<Page<NotificationVO>> getNotificationListByPage(
        @RequestBody(required = false) NotificationQueryDto queryDto) {
        try {
            NotificationQueryDto safeQuery = queryDto == null ? new NotificationQueryDto() : queryDto;
            safeQuery.setTargetId(CurrentUserHolder.getCurrentUserId());
            return ResponseUtil.successResponse(notificationService.queryManagePage(safeQuery));
        }
        catch (Exception e) {
            logger.error("分页查询当前用户通知失败", e);
            return ResponseUtil.fail("Failed to query notification page!" + e.getMessage());
        }
    }

    /**
     * 管理端分页查询通知
     */
    @PostMapping("/manage/page")
    public ResponseUtil<Page<NotificationVO>> managePage(@RequestBody NotificationQueryDto queryDto) {
        try {
            return ResponseUtil.successResponse(notificationService.queryManagePage(queryDto));
        }
        catch (Exception e) {
            logger.error("分页查询通知失败", e);
            return ResponseUtil.fail("Failed to query notification page!" + e.getMessage());
        }
    }

    /**
     * 管理端查询通知详情
     */
    @PostMapping("/manage/detail")
    public ResponseUtil<ByaiNotification> manageDetail(@RequestBody NotificationManageDto request) {
        try {
            if (request == null || request.getId() == null) {
                return ResponseUtil.fail("Parameter error: id cannot be empty!");
            }
            return ResponseUtil.successResponse(notificationService.getManageNotification(request.getId()));
        }
        catch (Exception e) {
            logger.error("查询通知详情失败", e);
            return ResponseUtil.fail("Failed to query notification detail!" + e.getMessage());
        }
    }

    /**
     * 管理端创建通知
     */
    @PostMapping("/manage/create")
    public ResponseUtil<ByaiNotification> manageCreate(@RequestBody NotificationManageDto request) {
        try {
            return ResponseUtil.successResponse(notificationService.createManageNotification(request));
        }
        catch (Exception e) {
            logger.error("创建通知失败", e);
            return ResponseUtil.fail("Failed to create notification!" + e.getMessage());
        }
    }

    /**
     * 管理端更新通知
     */
    @PostMapping("/manage/update")
    public ResponseUtil<ByaiNotification> manageUpdate(@RequestBody NotificationManageDto request) {
        try {
            return ResponseUtil.successResponse(notificationService.updateManageNotification(request));
        }
        catch (Exception e) {
            logger.error("更新通知失败", e);
            return ResponseUtil.fail("Failed to update notification!" + e.getMessage());
        }
    }

    /**
     * 管理端删除通知
     */
    @PostMapping("/manage/delete")
    public ResponseUtil<Boolean> manageDelete(@RequestBody NotificationManageDto request) {
        try {
            if (request == null || request.getId() == null) {
                return ResponseUtil.fail("Parameter error: id cannot be empty!");
            }
            return ResponseUtil.successResponse(notificationService.deleteManageNotification(request.getId()));
        }
        catch (Exception e) {
            logger.error("删除通知失败", e);
            return ResponseUtil.fail("Failed to delete notification!" + e.getMessage());
        }
    }

    /**
     * 查询最新版本通知
     */
    @PostMapping("/version/latest")
    public ResponseUtil<ByaiNotification> latestVersionNotification() {
        try {
            return ResponseUtil.successResponse(notificationService.getLatestVersionNotification());
        }
        catch (Exception e) {
            logger.error("查询最新版本通知失败", e);
            return ResponseUtil.fail("Failed to query latest version notification!" + e.getMessage());
        }
    }

    /**
     * 批量设置通知已读
     *
     * @param notificationReadDto 通知已读参数
     * @return ResponseUtil
     */
    @PostMapping("/batchSetNotificationRead")
    public ResponseUtil<Integer> batchSetNotificationRead(@RequestBody @Valid NotificationReadDto notificationReadDto) {
        try {
            // 设置当前登录用户ID作为接收者ID
            Long currentUserId = CurrentUserHolder.getCurrentUserId();
            if (currentUserId == null) {
                logger.error("获取当前用户ID失败");
                return ResponseUtil.fail("Failed to fetch current user information!");
            }

            // 参数验证
            if (StringUtils.isEmpty(notificationReadDto.getRead())
                || !"ALL".equalsIgnoreCase(notificationReadDto.getRead())) {
                // read为空时，判断idList不能为空
                if (CollectionUtils.isEmpty(notificationReadDto.getIdList())) {
                    logger.error("参数验证失败：read为空时idList不能为空");
                    return ResponseUtil.fail("Parameter error: When 'read' is empty, 'idList' cannot be empty!");
                }
            }

            // 构建请求参数
            notificationReadDto.setTargetId(currentUserId);

            logger.info("批量设置通知已读，参数：{}", notificationReadDto);

            int updateCount = notificationService.batchSetNotificationRead(notificationReadDto);

            ResponseUtil<Integer> resultUtil = new ResponseUtil<Integer>();
            resultUtil.setCode(0);
            resultUtil.setMsg("更新了" + updateCount + "条记录");
            resultUtil.setData(updateCount);
            return resultUtil;
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail("Failed to mark notification as read!" + e.getMessage());
        }
    }

}
