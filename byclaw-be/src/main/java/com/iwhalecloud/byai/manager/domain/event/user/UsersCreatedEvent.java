package com.iwhalecloud.byai.manager.domain.event.user;

import org.springframework.context.ApplicationEvent;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import java.util.List;
import lombok.Getter;

/**
 * 用户创建事件
 */
@Getter
public class UsersCreatedEvent extends ApplicationEvent {

    /**
     * 用户信息
     */
    private final Users users;

    /**
     * 用户关联组织信息
     */
    private final List<UsersOrganization> usersOrganizations;

    /**
     * @param source 事件源
     * @param users 用户信息
     * @param usersOrganizations 用户关联组织岗位信息
     */
    public UsersCreatedEvent(Object source, Users users, List<UsersOrganization> usersOrganizations) {
        super(source);
        this.users = users;
        this.usersOrganizations = usersOrganizations;
    }

}
