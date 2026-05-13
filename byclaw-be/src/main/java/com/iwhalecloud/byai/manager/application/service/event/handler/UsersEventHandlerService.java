package com.iwhalecloud.byai.manager.application.service.event.handler;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.manager.application.service.event.base.BaseEventHandlerService;
import com.iwhalecloud.byai.manager.domain.event.user.UsersCreatedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersDeletedEvent;
import com.iwhalecloud.byai.manager.domain.event.user.UsersUpdatedEvent;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.common.constants.events.UsersEventType;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import com.alibaba.fastjson.JSON;
import com.google.common.collect.ImmutableMap;
import com.iwhalecloud.byai.manager.infrastructure.kafka.ZlogAdapter;

/**
 * 事件处理服务
 */
@Component
public class UsersEventHandlerService extends BaseEventHandlerService {

    private static final Logger logger = LoggerFactory.getLogger(UsersEventHandlerService.class);


    /**
     * 事件来源
     */
    private static final String SOURCE_USERS = "userService";

    /**
     * 同步kafka用户主题
     */
    private static final String USER_EVENTS_TOPIC = "user-events";

    @Autowired(required = false)
    private ZlogAdapter zlogAdapter;

    /**
     * 处理用户创建事件
     *
     * @param event 用户创建事件
     */
    public void handleUserCreatedEvent(UsersCreatedEvent event) {
        if (zlogAdapter == null) {
            return;
        }

        Users users = event.getUsers();
        List<UsersOrganization> usersOrganizations = event.getUsersOrganizations();

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_USERS, UsersEventType.CREATE));
        jsonMap.put("payload", ImmutableMap.of("user", buildUsers(users, usersOrganizations)));

        logger.info("新增用户同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(USER_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

    /**
     * 处理用户更新事件
     *
     * @param event 用户更新事件
     */
    public void handleUserUpdatedEvent(UsersUpdatedEvent event) {
        if (zlogAdapter == null) {
            return;
        }

        Users users = event.getUsers();
        List<UsersOrganization> usersOrganizations = event.getUsersOrganizations();

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_USERS, UsersEventType.UPDATE));
        jsonMap.put("payload", ImmutableMap.of("user", buildUsers(users, usersOrganizations)));

        logger.info("更新用户同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(USER_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

    /**
     * 处理用户删除事件
     *
     * @param event 用户删除事件
     */
    public void handleUserDeletedEvent(UsersDeletedEvent event) {
        if (zlogAdapter == null) {
            return;
        }

        Map<String, Object> users = new HashMap<>(2);
        users.put("userId", event.getUserId());

        Map<String, Object> jsonMap = new HashMap<>(2);
        jsonMap.put("metadata", super.buildMetadata(SOURCE_USERS, UsersEventType.DELETE));
        jsonMap.put("payload", ImmutableMap.of("user", users));

        logger.info("删除用户同步kafka:{}", JSON.toJSONString(jsonMap));

        zlogAdapter.send(USER_EVENTS_TOPIC, JSON.toJSONString(jsonMap));
    }

    /**
     * 构建用户信息
     *
     * @param users 用户信息
     * @param usersOrganizations 用户关联组织岗位信息
     * @return 用户信息Map
     */
    private Map<String, Object> buildUsers(Users users, List<UsersOrganization> usersOrganizations) {
        Map<String, Object> user = new HashMap<>(10);
        user.put("userId", users.getUserId());
        user.put("userCode", users.getUserCode());
        user.put("userName", users.getUserName());
        user.put("email", users.getEmail());
        user.put("phone", users.getPhone());
        user.put("userNumber", users.getUserNumber());
        user.put("usersOrganizations", usersOrganizations);
        return user;
    }
}
