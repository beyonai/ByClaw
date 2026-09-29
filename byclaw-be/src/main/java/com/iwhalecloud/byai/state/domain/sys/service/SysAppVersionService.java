package com.iwhalecloud.byai.state.domain.sys.service;

import java.io.IOException;
import java.io.InputStream;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.security.DigestInputStream;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.Date;
import java.util.HexFormat;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;
import com.iwhalecloud.byai.common.storage.model.ParsedFileInfo;
import com.iwhalecloud.byai.common.storage.util.FileUtil;
import com.iwhalecloud.byai.manager.entity.system.SysAppVersion;
import com.iwhalecloud.byai.manager.mapper.system.SysAppVersionMapper;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionQuery;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionRequest;
import com.iwhalecloud.byai.state.domain.sys.dto.AppVersionUploadResult;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.io.IOUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.HttpStatus;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.server.ResponseStatusException;

/**
 * 应用版本信息服务实现类
 */
@Service
public class SysAppVersionService {

    /** 品牌版本配置：commercial 为商用版，其余视为开源版 */
    private static final String BRAND_VERSION_CONFIG = "BYAI_BRAND_VERSION";

    /** 桌面端固定设备类型，该字段语义不可修改 */
    private static final String DEVICE_TYPE_DESKTOP = "electron";

    private static final String RELEASE_DRAFT = "draft";
    private static final String RELEASE_PUBLISHED = "published";
    private static final String RELEASE_OFFLINE = "offline";

    private static final String UPDATE_STATUS_FORCE = "1";
    private static final String UPDATE_STATUS_NORMAL = "0";

    private static final int DEFAULT_PAGE_SIZE = 10;
    private static final int MAX_PAGE_SIZE = 100;

    @Autowired
    private SysAppVersionMapper sysAppVersionMapper;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private FileIngressService fileIngressService;

    @Value("${server.servlet.context-path:}")
    private String contextPath;

    /**
     * 取某设备类型下的最新已发布版本；platform/arch/channel 为空时不参与过滤，保持历史行为。
     */
    public SysAppVersion getLatestVersion(String deviceType, String platform, String arch, String channel) {
        SysAppVersion version = sysAppVersionMapper.selectLatestVersionByDeviceType(deviceType, platform, arch, channel);
        if (version != null) {
            version.setUrl(resolveClientDownloadUrl(version));
        }
        return version;
    }

    /**
     * 仅开源版 adminvip 可管理应用版本。
     */
    public boolean canManage() {
        String edition = byaiSystemConfigService.getDcSystemConfigValueByCode(BRAND_VERSION_CONFIG);
        return CurrentUserHolder.isAdminVip() && !"commercial".equalsIgnoreCase(edition);
    }

    public PageInfo<SysAppVersion> page(AppVersionQuery query) {
        guard();
        int pageNum = query.getPage() == null || query.getPage() < 1 ? 1 : query.getPage();
        int pageSize = query.getSize() == null || query.getSize() < 1 ? DEFAULT_PAGE_SIZE
            : Math.min(query.getSize(), MAX_PAGE_SIZE);

        LambdaQueryWrapper<SysAppVersion> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SysAppVersion::getDeviceType, DEVICE_TYPE_DESKTOP)
            .eq(StringUtils.isNotBlank(query.getPlatform()), SysAppVersion::getPlatform, query.getPlatform())
            .eq(StringUtils.isNotBlank(query.getArch()), SysAppVersion::getArch, query.getArch())
            .eq(StringUtils.isNotBlank(query.getChannel()), SysAppVersion::getChannel, query.getChannel())
            .eq(StringUtils.isNotBlank(query.getReleaseStatus()), SysAppVersion::getReleaseStatus,
                query.getReleaseStatus());
        if (StringUtils.isNotBlank(query.getKeyword())) {
            String keyword = query.getKeyword().trim();
            wrapper.and(inner -> inner.like(SysAppVersion::getAppVersion, keyword)
                .or().like(SysAppVersion::getFileName, keyword));
        }
        wrapper.orderByDesc(SysAppVersion::getPublishTime).orderByDesc(SysAppVersion::getVersionId);

        Page<SysAppVersion> page = sysAppVersionMapper.selectPage(new Page<>(pageNum, pageSize), wrapper);

        PageInfo<SysAppVersion> pageInfo = new PageInfo<>();
        pageInfo.setPageNum(pageNum);
        pageInfo.setPageSize(pageSize);
        pageInfo.setTotal(page.getTotal());
        pageInfo.setTotalPages((int) page.getPages());
        pageInfo.setList(page.getRecords());
        return pageInfo;
    }

    /**
     * 新增或编辑一条发布项；deviceType 固定写 electron，不接受调用方传入。
     */
    @Transactional
    public SysAppVersion save(Long versionId, AppVersionRequest request) {
        guard();
        SysAppVersion entity = null;
        if (versionId == null) {
            entity = new SysAppVersion();
            entity.setVersionId(sequenceService.nextVal());
            entity.setCreateBy(CurrentUserHolder.getCurrentUserId());
            entity.setCreateTime(new Date());
        }
        else {
            entity = sysAppVersionMapper.selectById(versionId);
            if (entity == null) {
                throw new ResponseStatusException(HttpStatus.NOT_FOUND, "应用版本不存在");
            }
        }

        boolean publishing = RELEASE_PUBLISHED.equals(request.getReleaseStatus());
        entity.setDeviceType(DEVICE_TYPE_DESKTOP);
        entity.setPlatform(request.getPlatform());
        entity.setArch(request.getArch());
        entity.setChannel(request.getChannel());
        entity.setAppVersion(request.getAppVersion().trim());
        entity.setUrl(request.getUrl().trim());
        entity.setUpdateType(StringUtils.defaultIfBlank(request.getUpdateType(), "full"));
        entity.setUpdateMsg(StringUtils.trimToEmpty(request.getUpdateMsg()));
        entity.setUpdateStatus(Boolean.TRUE.equals(request.getForceUpdate()) ? UPDATE_STATUS_FORCE
            : UPDATE_STATUS_NORMAL);
        entity.setFileName(StringUtils.trimToEmpty(request.getFileName()));
        entity.setFileSize(request.getFileSize());
        entity.setSha256(request.getSha256() == null ? null : request.getSha256().toLowerCase());
        entity.setReleaseStatus(publishing ? RELEASE_PUBLISHED : RELEASE_DRAFT);
        if (publishing) {
            entity.setPublishTime(new Date());
        }
        entity.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        entity.setUpdateTime(new Date());

        if (versionId == null) {
            sysAppVersionMapper.insert(entity);
        }
        else {
            sysAppVersionMapper.updateById(entity);
        }
        return entity;
    }

    @Transactional
    public SysAppVersion publish(Long versionId) {
        guard();
        SysAppVersion entity = requireVersion(versionId);
        entity.setReleaseStatus(RELEASE_PUBLISHED);
        entity.setPublishTime(new Date());
        touch(entity);
        return entity;
    }

    @Transactional
    public SysAppVersion offline(Long versionId) {
        guard();
        SysAppVersion entity = requireVersion(versionId);
        entity.setReleaseStatus(RELEASE_OFFLINE);
        touch(entity);
        return entity;
    }

    @Transactional
    public void delete(Long versionId) {
        guard();
        requireVersion(versionId);
        sysAppVersionMapper.deleteById(versionId);
    }

    /**
     * 安装包落专用桶，返回可直接写入 url 的存储地址。
     */
    public AppVersionUploadResult uploadPackage(MultipartFile file) {
        guard();
        if (file == null || file.isEmpty()) {
            throw new ResponseStatusException(HttpStatus.BAD_REQUEST, "安装包不能为空");
        }
        String sha256 = sha256Hex(file);
        FileStorageContext context = FileStorageContext.file(CurrentUserHolder.getCurrentUserId());
        FileMetadata metadata = fileIngressService.uploadFile(file, context, Constants.BUCKET_NAME_PACKAGE);
        if (StringUtils.isBlank(metadata.getFileUrl())) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "安装包存储未返回有效地址");
        }
        AppVersionUploadResult result = new AppVersionUploadResult();
        result.setFileName(StringUtils.defaultIfBlank(file.getOriginalFilename(), metadata.getFileName()));
        result.setFileSize(file.getSize());
        result.setUrl(metadata.getFileUrl());
        result.setSha256(sha256);
        return result;
    }

    /**
     * 免登录下载安装包：桌面端更新只做裸 fetch，拿不到任何登录凭证。
     */
    public void downloadPackage(Long versionId, HttpServletResponse response) throws IOException {
        SysAppVersion entity = sysAppVersionMapper.selectById(versionId);
        String url = entity == null ? null : entity.getUrl();
        if (StringUtils.isBlank(url)) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "安装包不存在");
        }
        if (url.startsWith("http://") || url.startsWith("https://")) {
            response.sendRedirect(url);
            return;
        }
        ParsedFileInfo fileInfo = FileUtil.parseFileUrl(url);
        if (StringUtils.isNotBlank(fileInfo.getBucketName())
            && !Constants.BUCKET_NAME_PACKAGE.equals(fileInfo.getBucketName())) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "安装包不存在");
        }
        String storageUrl = url;
        if (StringUtils.isBlank(fileInfo.getFilePath())) {
            // Local/file storage returns the object key directly (for example
            // /file/user_10001/20260923/app.dmg), while FileIngressService expects
            // a storage URL carrying both bucketName and fileName. App packages
            // always live in the dedicated package bucket, so restore that context
            // before delegating to the configured storage backend.
            storageUrl = FileUtil.generateFileAccessUrl(Constants.BUCKET_NAME_PACKAGE, url, "file");
        }

        String fileName = StringUtils.defaultIfBlank(entity.getFileName(), "byclaw-update");
        response.setContentType(MediaType.APPLICATION_OCTET_STREAM_VALUE);
        if (entity.getFileSize() != null) {
            response.setContentLengthLong(entity.getFileSize());
        }
        response.setHeader("Content-Disposition",
            "attachment;filename=" + URLEncoder.encode(fileName, StandardCharsets.UTF_8));
        try (InputStream inputStream = fileIngressService.downloadFile(storageUrl)) {
            IOUtils.copy(inputStream, response.getOutputStream());
        }
    }

    /**
     * 外部地址原样返回；对象存储地址换成免登录下载地址，避免桌面端拿到需要登录的预览地址。
     */
    private String resolveClientDownloadUrl(SysAppVersion version) {
        String url = version.getUrl();
        if (StringUtils.isBlank(url) || url.startsWith("http://") || url.startsWith("https://")) {
            return url;
        }
        return contextPath + "/api/v1/appVersion/package/" + version.getVersionId();
    }

    private SysAppVersion requireVersion(Long versionId) {
        SysAppVersion entity = sysAppVersionMapper.selectById(versionId);
        if (entity == null) {
            throw new ResponseStatusException(HttpStatus.NOT_FOUND, "应用版本不存在");
        }
        return entity;
    }

    private void touch(SysAppVersion entity) {
        entity.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        entity.setUpdateTime(new Date());
        sysAppVersionMapper.updateById(entity);
    }

    private String sha256Hex(MultipartFile file) {
        try (InputStream inputStream = file.getInputStream();
            DigestInputStream digestInputStream = new DigestInputStream(inputStream,
                MessageDigest.getInstance("SHA-256"))) {
            byte[] buffer = new byte[8192];
            while (digestInputStream.read(buffer) != -1) {
                // 顺序读完整包，摘要由 DigestInputStream 累加
            }
            return HexFormat.of().formatHex(digestInputStream.getMessageDigest().digest());
        }
        catch (IOException | NoSuchAlgorithmException exception) {
            throw new ResponseStatusException(HttpStatus.INTERNAL_SERVER_ERROR, "安装包校验和计算失败");
        }
    }

    private void guard() {
        if (!canManage()) {
            throw new ResponseStatusException(HttpStatus.FORBIDDEN, "仅开源版 adminvip 可管理应用版本");
        }
    }
}
