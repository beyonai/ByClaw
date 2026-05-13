package com.iwhalecloud.byai.manager.dto.men;

import lombok.Getter;
import lombok.Setter;

/**
 * @author he.duming
 * @date 2025-11-28 20:15:07
 * @description TODO
 */
@Getter
@Setter
public class NotifyResultDto {

    /**
     * 插入记录数
     */
    private boolean success;

    /**
     * 关联会话标识
     */
    private Long sessionId;

    /**
     * 关联消息标识
     */
    private Long messageId;

    public NotifyResultDto() {
    }

    public NotifyResultDto(boolean success) {
        this.success = success;
    }

}
