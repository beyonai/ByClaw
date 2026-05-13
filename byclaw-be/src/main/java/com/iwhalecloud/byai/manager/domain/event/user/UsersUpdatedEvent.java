package com.iwhalecloud.byai.manager.domain.event.user;

import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import org.springframework.context.ApplicationEvent;

import lombok.Getter;

import java.util.List;

/**
 * 用户更新事件
 */
@Getter
public class UsersUpdatedEvent extends ApplicationEvent {

    /**
     * 用户信息
     */
    private final Users users;

    /**
     * 用户关联组织岗位信息
     */
    private final List<UsersOrganization> usersOrganizations;

    /**
     * @param source 事件源
     * @param users 用户信息
     * @param usersOrganizations 用户关联组织岗位信息
     */
    public UsersUpdatedEvent(Object source, Users users, List<UsersOrganization> usersOrganizations) {
        super(source);
        this.users = users;
        this.usersOrganizations = usersOrganizations;
    }
}
