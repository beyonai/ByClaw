package com.iwhalecloud.byai.manager.infrastructure.sms;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.nio.charset.StandardCharsets;
import java.util.HashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.alibaba.fastjson.JSON;
import com.aliyun.dysmsapi20170525.Client;
import com.aliyun.dysmsapi20170525.models.SendSmsRequest;
import com.aliyun.dysmsapi20170525.models.SendSmsResponse;
import com.aliyun.teaopenapi.models.Config;
import com.iwhalecloud.byai.manager.infrastructure.config.AliyunSmsConfig;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;

@Service
public class AliyunSmsService {

    private static final Logger logger = LoggerFactory.getLogger(AliyunSmsService.class);


    @Autowired
    private AliyunSmsConfig smsConfig;

    private Client createClient() throws Exception {
        Config config = new Config().setAccessKeyId(smsConfig.getAccessKeyId())
            .setAccessKeySecret(smsConfig.getAccessKeySecret()).setEndpoint(smsConfig.getEndpoint());
        return new Client(config);
    }

    /**
     * 发送短信验证码
     * 
     * @param phoneNumber 手机号
     * @param code 验证码
     * @param type 短信类型: login-登录验证码, register-注册验证码
     * @return 是否发送成功
     */
    public boolean sendSms(String phoneNumber, String code, String templateType) {
        try {
            Client client = createClient();
            // 确保手机号和验证码都是数字格式
            if (!phoneNumber.matches("\\d+") || !code.matches("\\d+")) {
                logger.error("手机号或验证码格式错误: phone={}, code={}", phoneNumber, code);
                return false;
            }

            Map<String, String> templateParam = new HashMap<>();
            templateParam.put("code", code);

            // 根据类型选择对应的模板
            String templateCode;
            switch (templateType) {
                case "login":
                    templateCode = smsConfig.getTemplates().getLogin();
                    break;
                case "register":
                    templateCode = smsConfig.getTemplates().getRegister();
                    break;
                default:
                    throw new IllegalArgumentException(I18nUtil.get("sms.type.unsupported", templateType));
            }

            SendSmsRequest request = new SendSmsRequest().setPhoneNumbers(phoneNumber)
                .setSignName(getSignName(smsConfig.getSignName())).setTemplateCode(templateCode)
                .setTemplateParam(JSON.toJSONString(templateParam));
            logger.info("Sending SMS's param is : {}", JSON.toJSONString(request));
            SendSmsResponse response = client.sendSms(request);
            if (!"OK".equals(response.getBody().getCode())) {
                throw new BaseException(I18nUtil.get("sms.send.failed", response.getBody().getMessage()));
            }
            return true;
        }
        catch (Exception e) {
            throw new BaseException(I18nUtil.get("sms.send.failed", e.getMessage()));
        }
    }

    private String getSignName(String signName) {
        String newName = null;
        if (signName == null || signName.trim().isEmpty()) {
            return newName;
        }

        // 直接尝试从ISO-8859-1转换到UTF-8
        String converted = new String(signName.getBytes(StandardCharsets.ISO_8859_1), StandardCharsets.UTF_8);
        // 检查转换结果是否包含中文字符
        if (converted.matches(".*[\\u4e00-\\u9fa5].*")) {
            newName = converted;
        }
        else {
            newName = signName;
        }

        logger.info("signName is :{}, newSignName is :{}", signName, newName);
        return newName;
    }

}