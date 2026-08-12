package com.iwhalecloud.byai.manager.domain.event.user;

import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;

import org.springframework.context.ApplicationEvent;

import lombok.Getter;

/**
 * 用户组织关系变更事件。
 *
 * @author qin.guoquan
 * @date 2026-08-12 14:00:38
 */
@Getter
public class UserOrganizationChangedEvent extends ApplicationEvent {

    private final Set<Long> userIds;

    public UserOrganizationChangedEvent(Object source, Collection<Long> userIds) {
        super(source);
        this.userIds = userIds == null ? Set.of() : new LinkedHashSet<>(userIds);
    }
}
