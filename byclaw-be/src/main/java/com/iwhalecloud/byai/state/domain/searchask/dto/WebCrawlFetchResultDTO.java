package com.iwhalecloud.byai.state.domain.searchask.dto;

import java.io.Serializable;

import lombok.Getter;
import lombok.Setter;

/**
 * 网页抓取结果：成功时返回 HTML，失败时返回原因。
 *
 * @author system
 */
@Getter
@Setter
public class WebCrawlFetchResultDTO implements Serializable {

    private static final long serialVersionUID = 1L;

    /**
     * 是否抓取成功
     */
    private boolean success;

    /**
     * 成功时的 HTML 内容
     */
    private String html;

    /**
     * 失败时的原因描述（安全描述，不暴露内部信息）
     */
    private String failureReason;

    /**
     * 无参构造，避免 SpotBugs CT_CONSTRUCTOR_THROW（Lombok 生成构造器可能被误报）
     */
    public WebCrawlFetchResultDTO() {
    }

    /**
     * 全参构造，用于反序列化等场景；不执行可能抛异常的逻辑，避免 Finalizer 攻击风险
     *
     * @param success       是否成功
     * @param html          HTML 内容
     * @param failureReason 失败原因
     */
    public WebCrawlFetchResultDTO(boolean success, String html, String failureReason) {
        this.success = success;
        this.html = html;
        this.failureReason = failureReason;
    }

    /**
     * 构建成功结果
     *
     * @param html HTML 内容
     * @return 成功结果
     */
    public static WebCrawlFetchResultDTO success(String html) {
        WebCrawlFetchResultDTO r = new WebCrawlFetchResultDTO();
        r.setSuccess(true);
        r.setHtml(html);
        return r;
    }

    /**
     * 构建失败结果
     *
     * @param failureReason 失败原因（应对用户展示做安全脱敏）
     * @return 失败结果
     */
    public static WebCrawlFetchResultDTO fail(String failureReason) {
        WebCrawlFetchResultDTO r = new WebCrawlFetchResultDTO();
        r.setSuccess(false);
        r.setFailureReason(failureReason);
        return r;
    }
}
