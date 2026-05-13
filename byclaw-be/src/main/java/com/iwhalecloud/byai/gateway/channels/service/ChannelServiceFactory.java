package com.iwhalecloud.byai.gateway.channels.service;

import com.google.common.collect.Maps;
import com.iwhalecloud.byai.gateway.channels.enums.ChannelType;
import com.iwhalecloud.byai.gateway.channels.service.app.AppChannelService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.DingtalkChannelService;
import com.iwhalecloud.byai.gateway.channels.service.web.WebChannelService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import jakarta.annotation.PostConstruct;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import java.util.Map;

/**
 * 渠道服务工厂类
 *
 * @author byai
 * @version 1.0
 * @date 2026/4/7
 */
@Slf4j
@Component
public class ChannelServiceFactory {

    private static final Map<ChannelType, ChannelService> CHANNEL_SERVICE_MAP = Maps.newHashMap();

    @Autowired
    private AppChannelService appChannelService;

    @Autowired
    private DingtalkChannelService dingtalkChannelService;

    @Autowired
    private WebChannelService webChannelService;

    /**
     * 初始化工厂，注册所有渠道服务
     */
    @PostConstruct
    public void init() {
        register(appChannelService);
        register(dingtalkChannelService);
        register(webChannelService);
        log.info("渠道服务工厂初始化完成，共注册 {} 个渠道服务", CHANNEL_SERVICE_MAP.size());
    }

    /**
     * 注册渠道服务
     *
     * @param channelService 渠道服务实现
     */
    private void register(ChannelService channelService) {
        CHANNEL_SERVICE_MAP.put(channelService.getChannelType(), channelService);
        log.info("注册渠道服务: {}", channelService.getChannelType().getCode());
    }

    /**
     * 根据渠道类型获取对应的服务
     *
     * @param channelType 渠道类型
     * @return 渠道服务
     */
    public static ChannelService getService(ChannelType channelType) {
        ChannelService service = CHANNEL_SERVICE_MAP.get(channelType);
        if (service == null) {
            throw new BdpRuntimeException(I18nUtil.get("channel.service.factory.type.error", channelType.getCode()));
        }
        return service;
    }

    /**
     * 根据渠道类型代码获取对应的服务
     *
     * @param channelCode 渠道类型代码
     * @return 渠道服务
     */
    public static ChannelService getService(String channelCode) {
        ChannelType channelType = ChannelType.getByCode(channelCode);
        if (channelType == null) {
            throw new BdpRuntimeException(I18nUtil.get("channel.service.factory.code.error", channelCode));
        }
        return getService(channelType);
    }

    /**
     * 判断渠道类型是否支持
     *
     * @param channelType 渠道类型
     * @return 是否支持
     */
    public static boolean isSupported(ChannelType channelType) {
        return CHANNEL_SERVICE_MAP.containsKey(channelType);
    }

    /**
     * 判断渠道类型代码是否支持
     *
     * @param channelCode 渠道类型代码
     * @return 是否支持
     */
    public static boolean isSupported(String channelCode) {
        ChannelType channelType = ChannelType.getByCode(channelCode);
        return channelType != null && CHANNEL_SERVICE_MAP.containsKey(channelType);
    }
}
