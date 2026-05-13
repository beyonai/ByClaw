package com.iwhalecloud.byai.common.config;

import lombok.Data;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.cloud.context.config.annotation.RefreshScope;
import org.springframework.context.annotation.Configuration;

import java.util.ArrayList;
import java.util.Arrays;
import java.util.List;
import java.util.stream.Collectors;

@Data
@Configuration
@RefreshScope
@ConfigurationProperties(prefix = "byai.security.sign")
public class SignAntiReplayConfig {

    /**
     * 安全校验开关
     */
    private Boolean enabled = false;

    /**
     * 签名过期时间，单位秒
     */
    private Long timeout = 5L;

    /**
     * 加密密钥
     */
    private String salt = "{#@*A12^c0+}";

    /**
     * 排除路径列表
     */
    private List<String> excludeUrlList = new ArrayList<>();

    /**
     * 排除路径字符串（逗号分隔）
     * 用于配置文件中的逗号分隔字符串配置
     */
    private String excludeUrlsStr;

    /**
     * 是否已经解析过字符串
     */
    private boolean parsed = false;

    /**
     * 设置排除路径字符串，并自动解析为列表
     *
     * @param excludeUrlsStr 逗号分隔的排除路径字符串
     */
    public void setExcludeUrlsStr(String excludeUrlsStr) {
        this.excludeUrlsStr = excludeUrlsStr;
        this.parsed = false; // 重置解析状态，下次获取时会重新解析
    }

    /**
     * 获取排除路径列表
     * 使用懒加载机制，只在需要时解析一次
     *
     * @return 排除路径列表
     */
    public List<String> getExcludeUrlList() {
        // 如果还没有解析过，且字符串不为空，则进行解析
        if (!parsed && excludeUrlsStr != null && !excludeUrlsStr.trim().isEmpty()) {
            parseExcludeUrlsStr();
        }
        return excludeUrlList;
    }

    /**
     * 解析排除路径字符串
     */
    private void parseExcludeUrlsStr() {
        if (excludeUrlsStr != null && !excludeUrlsStr.trim().isEmpty()) {
            // 解析逗号分隔的字符串，去除空格，过滤空字符串
            this.excludeUrlList = Arrays.stream(excludeUrlsStr.split(","))
                    .map(String::trim)
                    .filter(s -> !s.isEmpty())
                    .collect(Collectors.toList());
        }
        this.parsed = true; // 标记为已解析
    }


}
