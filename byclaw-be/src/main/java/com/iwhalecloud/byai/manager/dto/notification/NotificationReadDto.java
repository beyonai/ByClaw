package com.iwhalecloud.byai.manager.dto.notification;

import java.util.List;
import lombok.Getter;
import lombok.Setter;

/**
 * 通知已读DTO
 *
 * @author yy
 * @date 2024-12-20
 */
@Getter
@Setter
public class NotificationReadDto {

    /**
     * 通知ID列表（不能为空且至少包含一个元素）
     */
    private List<String> idList;

    /**
     * 接收者ID（当前登录用户）
     */
    private Long targetId;

    /**
     * 区分全部标记为已读
     */
    private String read;
}
