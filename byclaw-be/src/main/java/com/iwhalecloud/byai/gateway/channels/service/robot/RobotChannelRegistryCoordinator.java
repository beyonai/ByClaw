package com.iwhalecloud.byai.gateway.channels.service.robot;

import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.feishu.FeishuRobotRegistryService;
import com.iwhalecloud.byai.gateway.channels.service.wecom.stream.lifecycle.WecomRobotRegistryService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;

/**
 * 多机器人渠道注册协调器。
 *
 * <p>数字员工保存、更新、删除属于业务生命周期事件，不应该知道每个第三方渠道的注册细节。
 * 该协调器统一调用钉钉、飞书、企微等渠道的 registry；后续新增 Slack 时，只需要在这里扩展。</p>
 */
@Service
public class RobotChannelRegistryCoordinator {

    private static final Logger logger = LoggerFactory.getLogger(RobotChannelRegistryCoordinator.class);

    private final DingtalkRobotRegistryService dingtalkRobotRegistryService;
    private final FeishuRobotRegistryService feishuRobotRegistryService;
    private final WecomRobotRegistryService wecomRobotRegistryService;

    public RobotChannelRegistryCoordinator(
            DingtalkRobotRegistryService dingtalkRobotRegistryService,
            FeishuRobotRegistryService feishuRobotRegistryService,
            WecomRobotRegistryService wecomRobotRegistryService
    ) {
        this.dingtalkRobotRegistryService = dingtalkRobotRegistryService;
        this.feishuRobotRegistryService = feishuRobotRegistryService;
        this.wecomRobotRegistryService = wecomRobotRegistryService;
    }

    public void registerForResource(Long resourceId) {
        runQuietly("register DingTalk robot clients", resourceId,
                () -> dingtalkRobotRegistryService.registerRobotClientsForResource(resourceId));
        runQuietly("register Feishu robot clients", resourceId,
                () -> feishuRobotRegistryService.registerRobotClientsForResource(resourceId));
        runQuietly("register WeCom robot clients", resourceId,
                () -> wecomRobotRegistryService.registerRobotClientsForResource(resourceId));
    }

    public void refreshForResource(Long resourceId) {
        runQuietly("refresh DingTalk robot clients", resourceId,
                () -> dingtalkRobotRegistryService.refreshRobotClientsForResource(resourceId));
        runQuietly("refresh Feishu robot clients", resourceId,
                () -> feishuRobotRegistryService.refreshRobotClientsForResource(resourceId));
        runQuietly("refresh WeCom robot clients", resourceId,
                () -> wecomRobotRegistryService.refreshRobotClientsForResource(resourceId));
    }

    public void unregisterForResource(Long resourceId) {
        runQuietly("unregister DingTalk robot clients", resourceId,
                () -> dingtalkRobotRegistryService.unregisterRobotClientsForResource(resourceId));
        runQuietly("unregister Feishu robot clients", resourceId,
                () -> feishuRobotRegistryService.unregisterRobotClientsForResource(resourceId));
        runQuietly("unregister WeCom robot clients", resourceId,
                () -> wecomRobotRegistryService.unregisterRobotClientsForResource(resourceId));
    }

    private void runQuietly(String action, Long resourceId, Runnable runnable) {
        try {
            runnable.run();
        } catch (Exception e) {
            logger.warn("{} failed. resourceId={}", action, resourceId, e);
        }
    }
}
