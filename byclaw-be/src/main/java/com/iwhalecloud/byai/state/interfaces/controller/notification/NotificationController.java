package com.iwhalecloud.byai.state.interfaces.controller.notification;

import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.notification.NotificationReadDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
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
