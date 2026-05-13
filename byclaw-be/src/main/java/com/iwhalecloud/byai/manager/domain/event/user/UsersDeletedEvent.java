package com.iwhalecloud.byai.manager.domain.event.user;

import org.springframework.context.ApplicationEvent;

import lombok.Getter;

/**
 * 用户删除事件
 */
@Getter
public class UsersDeletedEvent extends ApplicationEvent {

    /**
     * 用户标识
     */
    private Long userId;

    /**
     * 用户删除事件
     * 
     * @param source 事件源
     * @param userId 用户标识
     */
    public UsersDeletedEvent(Object source, Long userId) {
        super(source);
        this.userId = userId;
    }

}
