package com.iwhalecloud.byai.manager.interfaces.controller.files;

import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.web.ApplicationContextUtil;
import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.storage.util.UserBucketNameResolver;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.infrastructure.filter.sub.SessionFilter;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

import java.io.IOException;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;

/**
 * @author he.duming
 * @date 2026-04-30 00:07:52
 * @description TODO
 */
@RestController
@RequestMapping("/commonFile")
public class FilesController {

    private static final Logger logger = LoggerFactory.getLogger(FilesController.class);

    @Autowired
    private FilesApplicationService filesApplicationService;

    @Autowired
    private SessionFilter sessionFilter;

    /**
     * 上传图标
     *
     * @param multipartFile 文件
     * @return ResponseUtil
     */
    @PostMapping(path = "/uploadIcon", consumes = MediaType.MULTIPART_FORM_DATA_VALUE,
        produces = MediaType.APPLICATION_JSON_VALUE)
    public ResponseUtil<Files> uploadIcon(@RequestPart("file") MultipartFile multipartFile) {
        try {
            Files files = filesApplicationService.uploadIcon(multipartFile);

            return ResponseUtil.successResponse(I18nUtil.get("digemployee.status.stats.query.success"), files);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 文件下载
     *
     * @param response 响应流
     * @param style 文件格式
     * @param bucketName 桶名称
     * @param filePath 文件名称
     */
    @GetMapping(path = "/preview")
    public void preview(HttpServletResponse response,
        @RequestParam(value = "style", required = false) String style,
        @RequestParam(value = "bucketName", required = false) String bucketName,
        @RequestParam("filePath") String filePath) {
        filesApplicationService.preview(response, style, bucketName, filePath);
    }

    /**
     * 文件下载
     *
     * @param response 响应
     * @param fileId 文件标识
     */
    @GetMapping(path = "/download")
    public void preview(HttpServletResponse response, @RequestParam("fileId") Long fileId) {
        filesApplicationService.download(response, fileId);
    }

    /**
     * 文件查看（未登录时重定向到登录页）
     */
    @GetMapping(path = "/view")
    public void view(HttpServletRequest request, HttpServletResponse response,
        @RequestParam(value = "style", required = false) String style,
        @RequestParam(value = "bucketName", required = false) String bucketName,
        @RequestParam("filePath") String filePath) throws IOException {
        HttpSession httpSession = request.getSession(false);
        String userCode = httpSession != null
            ? (String) httpSession.getAttribute("USER_CODE") : null;
        if (StringUtils.isNotEmpty(userCode)) {
            sessionFilter.doFilter(httpSession);
        }
        if (StringUtils.isEmpty(userCode)) {
            String currentUrl = request.getRequestURL().toString();
            String queryString = request.getQueryString();
            if (queryString != null) {
                currentUrl += "?" + queryString;
            }
            ByaiSystemConfigService configService = ApplicationContextUtil.getBean(ByaiSystemConfigService.class);
            String webBaseUrl = configService.getDcSystemConfigValueByCode(Constants.WEB_BASE_URL);
            String env = System.getenv("BE_ENV");
            // development 环境前端无 /beyond 基路径，直连本地 dev server；生产带 /beyond 前缀。
            boolean isDev = StringUtils.isNotEmpty(env) && "development".equals(env);
            String loginPath = isDev ? "/mobile/login" : "/beyond/mobile/login";
            if (isDev) {
                webBaseUrl = "http://localhost:8000";
            }
            String redirectUrl = (webBaseUrl != null ? webBaseUrl : "") + loginPath
                + "?redirectUrl=" + URLEncoder.encode(currentUrl, StandardCharsets.UTF_8);
            response.sendRedirect(redirectUrl);
            return;
        }
        // 用户桶（byclaw-{userCode}）越权校验：传入的是某用户的私有桶时，必须与当前登录用户一致。
        // 公共桶（如 byclaw，不带 -userCode）不在此限。
        if (StringUtils.startsWith(bucketName, "byclaw-")) {
            String expectedBucket;
            try {
                expectedBucket = UserBucketNameResolver.buildUserBucketName(userCode);
            } catch (Exception e) {
                logger.warn("Build bucket name failed for userCode={}", userCode, e);
                expectedBucket = null;
            }
            if (!StringUtils.equals(bucketName, expectedBucket)) {
                logger.warn("Bucket access denied: bucket={}, loginUser={}, expectedBucket={}",
                    bucketName, userCode, expectedBucket);
                response.setStatus(HttpServletResponse.SC_FORBIDDEN);
                response.setContentType("application/json;charset=UTF-8");
                response.getWriter().write("{\"code\":-1,\"msg\":\"无权访问该文件\"}");
                return;
            }
        }
        filesApplicationService.preview(response, style, bucketName, filePath);
    }

}
