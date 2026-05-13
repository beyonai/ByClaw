package com.iwhalecloud.byai.manager.application.service.digitemploy.event;

import java.util.Collections;
import java.util.Set;

/**
 * 本 JVM / 本 Pod 内「当前仍关心数字员工变更」的用户集合，供 Stream 消费端做授权过滤。
 * <p>
 * 默认空实现：不跟踪任何用户时，消费端仅记录日志；业务可注册自定义 Bean 返回活跃会话用户等。
 */
@FunctionalInterface
public interface DigEmployeeChangeLocalUserRegistry {

    /**
     * @return 本实例当前关心的用户 ID（不可变快照即可）
     */
    Set<Long> getLocallyTrackedUserIds();

    static DigEmployeeChangeLocalUserRegistry empty() {
        return Collections::emptySet;
    }
}
