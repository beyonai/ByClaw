package com.iwhalecloud.byai.gateway.channels.service.feishu.model;

import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工 machineChannel 中的飞书机器人配置。
 *
 * <p>当前与钉钉一样保存在 ss_res_ext_dig_employee.machine_channel 的 JSON 数组中。
 * appId 是飞书应用的稳定标识，也作为系统内“机器人绑定数字员工”的匹配 key。</p>
 */
@Getter
@Setter
public class FeishuRobotChannelConfig {

    private Long resourceId;
    private String resourceName;
    private String channel;
    private String appId;
    private String appSecret;
    private String verificationToken;
    private String encryptKey;
    private String botId;
    private String cardTemplateId;
}
