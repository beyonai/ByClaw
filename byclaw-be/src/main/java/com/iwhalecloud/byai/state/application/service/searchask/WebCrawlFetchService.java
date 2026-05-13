package com.iwhalecloud.byai.state.application.service.searchask;

import java.io.IOException;
import java.net.SocketTimeoutException;
import java.nio.charset.StandardCharsets;

import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.state.domain.searchask.dto.WebCrawlFetchResultDTO;
import com.iwhalecloud.byai.common.storage.util.MultipartFileUtil;
import org.jsoup.Jsoup;
import org.jsoup.UnsupportedMimeTypeException;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import java.net.URL;
import java.util.Arrays;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 网页抓取服务：对指定 URL 发起 GET 请求，支持超时与编码处理，并对异常进行分类。 用于联网搜索归档时爬取 source_url 对应的页面内容。
 *
 * @author system
 */
@Service
public class WebCrawlFetchService {

    private static final Logger LOG = LoggerFactory.getLogger(WebCrawlFetchService.class);

    /**
     * 读取超时（毫秒），同时用于连接与读取
     */
    @Value("${web.crawl.readTimeout:10000}")
    private int readTimeout;

    /**
     * 允许爬取的域名白名单，逗号分隔；为空则仅校验协议为 http/https，不限制域名
     */
    @Value("${web.crawl.allowedHosts:}")
    private String allowedHosts;

    /**
     * 抓取指定 URL 的 HTML 内容。
     *
     * @param url 目标 URL，需为合法 HTTP/HTTPS 地址
     * @return 抓取结果，成功时包含 HTML，失败时包含可对用户展示的 failureReason
     */
    public WebCrawlFetchResultDTO fetch(String url) {
        if (StringUtil.isEmpty(url)) {
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.url.empty");
        }
        String hostCheck = validateUrlAndHost(url);
        if (hostCheck != null) {
            return WebCrawlFetchResultDTO.fail(hostCheck);
        }
        try {
            String html = Jsoup.connect(url).timeout(readTimeout).ignoreContentType(false)
                .userAgent("Mozilla/5.0 (compatible; ByAI-WebCrawl/1.0)").maxBodySize(1024 * 1024).get().html();
            return WebCrawlFetchResultDTO.success(html);
        }
        catch (SocketTimeoutException e) {
            LOG.warn("网页抓取超时, url={}", maskUrlForLog(url));
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.timeout");
        }
        catch (UnsupportedMimeTypeException e) {
            LOG.warn("不支持的媒体类型, url={}, mimeType={}", maskUrlForLog(url), e.getMimeType());
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.unsupported.type");
        }
        catch (IOException e) {
            return mapIOExceptionToResult(e, url);
        }
        catch (Exception e) {
            LOG.warn("网页抓取异常, url={}", maskUrlForLog(url), e);
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.failed");
        }
    }

    /**
     * 根据 IOException 信息映射为对用户展示的失败结果（404/403/4xx5xx 等）
     *
     * @param e   IO 异常
     * @param url 请求 URL（用于日志脱敏）
     * @return 失败结果 DTO
     */
    private WebCrawlFetchResultDTO mapIOExceptionToResult(IOException e, String url) {
        String msg = e.getMessage();
        if (msg != null && (msg.contains("404") || msg.contains("Not Found"))) {
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.not.found");
        }
        if (msg != null && (msg.contains("403") || msg.contains("Forbidden"))) {
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.forbidden");
        }
        if (msg != null && msg.matches(".*[45][0-9][0-9].*")) {
            return WebCrawlFetchResultDTO.fail("web.crawl.fetch.http.error");
        }
        LOG.warn("网页抓取失败, url={}, error={}", maskUrlForLog(url), msg);
        return WebCrawlFetchResultDTO.fail("web.crawl.fetch.failed");
    }

    /**
     * 日志中仅输出域名等安全信息，避免输出完整 URL 中可能存在的敏感参数
     *
     * @param url 原始 URL
     * @return 脱敏后的描述
     */
    private String maskUrlForLog(String url) {
        if (url == null || url.length() < 30) {
            return url;
        }
        try {
            URL u = new URL(url);
            return u.getHost()
                + (u.getPath() != null && u.getPath().length() > 20 ? u.getPath().substring(0, 20) + "..." : "");
        }
        catch (Exception e) {
            return "***";
        }
    }

    /**
     * 校验 URL 协议与域名白名单，防止 SSRF。 仅允许 http/https；若配置了 allowedHosts，则主机必须在白名单内。
     *
     * @param url 待抓取 URL
     * @return 校验通过返回 null，否则返回失败原因 i18n key
     */
    private String validateUrlAndHost(String url) {
        try {
            URL u = new URL(url);
            String protocol = u.getProtocol();
            if (!"http".equalsIgnoreCase(protocol) && !"https".equalsIgnoreCase(protocol)) {
                return "web.crawl.fetch.protocol.not.allowed";
            }
            if (StringUtil.isNotEmpty(allowedHosts)) {
                Set<String> allowed = Arrays.stream(allowedHosts.split(",")).map(String::trim).filter(s -> !s.isEmpty())
                    .map(String::toLowerCase).collect(Collectors.toSet());
                String host = u.getHost();
                if (host == null || !allowed.contains(host.toLowerCase())) {
                    return "web.crawl.fetch.host.not.allowed";
                }
            }
            return null;
        }
        catch (Exception e) {
            return "web.crawl.fetch.url.invalid";
        }
    }

    /**
     * 将 Markdown 字符串转为 MultipartFile 形式，便于上传存储。
     *
     * @param markdown Markdown 内容
     * @param fileName 文件名（建议 .md 后缀）
     * @return 内存型 MultipartFile，不会落盘
     */
    public MultipartFile markdownToMultipartFile(String markdown, String fileName) {
        byte[] bytes = (markdown == null ? "" : markdown).getBytes(StandardCharsets.UTF_8);
        return new MultipartFileUtil(fileName, fileName, "text/markdown", bytes);
    }
}
