package com.iwhalecloud.byai.state.application.service.session;

import java.io.IOException;
import java.io.InputStream;
import java.io.OutputStream;
import java.util.List;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.servlet.mvc.method.annotation.StreamingResponseBody;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;

/**
 * 用户工作空间 skill 下载应用服务。
 * @author qin.guoquan
 * @date 2026-05-15 18:37:18
 */
@Service
public class ByClawSkillDownloadApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(ByClawSkillDownloadApplicationService.class);

    /** 单文件流式拷贝的缓冲区大小，与 JDK 默认 8KB 对齐。 */
    private static final int COPY_BUFFER_SIZE = 8 * 1024;

    @Autowired
    private UserFS userFS;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 准备一次 skill 下载。校验路径合规并返回 (zipFileName, body) 二元组；body 由 controller 直接交给 Spring 写回响应。
     *
     * @param userCode  目标用户编码（决定 bucket 名）
     * @param resourceId 数字员工资源 ID；为空时按超级助手 skills 根目录解析
     * @param skillPath 数字员工形如 "/.openclaw/workspace-baiying-agent-{resourceId}/skills/fol-auto-biztravel"，
     *                  超级助手形如 "/.openclaw/workspace/skills/fol-auto-biztravel"
     * @return 可直接 ResponseEntity.body() 的 StreamingResponseBody + 建议下载文件名
     */
    public SkillZipDownload prepare(String userCode, Long resourceId, String skillPath) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        String normalizedSkillPath = normalizeSkillPath(skillPath, resourceId);
        String skillName = extractSkillName(normalizedSkillPath);

        // 提前列对象一次：让"路径不存在 / skill 为空"在 controller 进入流式输出前就能转成可读错误。
        // 流式输出阶段已经写入了 HTTP 响应头，再抛错的体验比较差。
        List<String> objectKeys = ByClawUserWorkspacePaths.withUserContext(userCode,
            () -> userFS.list(normalizedSkillPath + "/", null));
        if (objectKeys == null || objectKeys.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.empty"));
        }

        StreamingResponseBody body = outputStream -> writeZip(userCode, normalizedSkillPath, objectKeys, outputStream);
        return new SkillZipDownload(skillName + ".zip", body);
    }

    private void writeZip(String userCode, String skillPath, List<String> objectKeys, OutputStream outputStream)
        throws IOException {
        try (ZipOutputStream zos = new ZipOutputStream(outputStream)) {
            int written = 0;
            for (String objectKey : objectKeys) {
                if (StringUtils.isBlank(objectKey)) {
                    continue;
                }
                String relative = relativizeUnderSkillRoot(objectKey, skillPath);
                if (relative == null) {
                    // 防御性跳过：list 不应返回前缀外的对象，但保险起见兜底。
                    continue;
                }
                zos.putNextEntry(new ZipEntry(relative));
                // 每个对象单独切上下文读取，确保 bucket 解析正确；read 不预加载内容，按 8KB 流式拷贝。
                try (InputStream in = ByClawUserWorkspacePaths.withUserContext(userCode, () -> userFS.read(objectKey))) {
                    if (in != null) {
                        copy(in, zos);
                    }
                }
                zos.closeEntry();
                written++;
            }
            logger.info("skill 下载打包完成, userCode={}, skillPath={}, fileCount={}", userCode, skillPath, written);
        }
    }

    private void copy(InputStream in, OutputStream out) throws IOException {
        byte[] buf = new byte[COPY_BUFFER_SIZE];
        int n;
        while ((n = in.read(buf)) > 0) {
            out.write(buf, 0, n);
        }
    }

    /**
     * 入参合规化：
     * - 必须以当前 resourceId 对应的 skills 根目录开头；
     * - 拒绝 ".." 段；
     * - 去除尾部 '/'；
     * - 必须至少落在一个具体的 skill 目录上（前缀本身不允许，避免一次拉走所有 skills）。
     */
    private String normalizeSkillPath(String skillPath, Long resourceId) {
        if (StringUtils.isBlank(skillPath)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        String skillRootPrefix = resolveSkillRootPrefix(resourceId);
        String normalized = skillPath.replace('\\', '/').replaceAll("/+", "/");
        if (!normalized.startsWith("/")) {
            normalized = "/" + normalized;
        }
        if (normalized.endsWith("/")) {
            normalized = normalized.substring(0, normalized.length() - 1);
        }
        if (!normalized.startsWith(skillRootPrefix)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        for (String seg : normalized.split("/")) {
            if ("..".equals(seg)) {
                throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
            }
        }
        // 必须比 skills 根目录多至少一段（具体 skill 名）。
        String tail = normalized.substring(skillRootPrefix.length());
        if (StringUtils.isBlank(tail)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.download.path.invalid"));
        }
        return normalized;
    }

    private String resolveSkillRootPrefix(Long resourceId) {
        if (resourceId == null) {
            return ByClawUserWorkspacePaths.WORKSPACE_SKILL_ROOT_PREFIX;
        }
        SsResource resource = ssResourceService.findById(resourceId);
        String resourceCode = resource == null ? null : resource.getResourceCode();
        return ByClawUserWorkspacePaths.resolveSkillRootPrefix(resourceId, resourceCode);
    }

    private String extractSkillName(String normalizedSkillPath) {
        int slash = normalizedSkillPath.lastIndexOf('/');
        return slash >= 0 ? normalizedSkillPath.substring(slash + 1) : normalizedSkillPath;
    }

    /** 把对象 key 转换为 zip 内相对路径；不在 skillPath 之下时返回 null 表示跳过。 */
    private String relativizeUnderSkillRoot(String objectKey, String skillPath) {
        String prefix = skillPath + "/";
        if (!objectKey.startsWith(prefix)) {
            return null;
        }
        String relative = objectKey.substring(prefix.length());
        return StringUtils.isBlank(relative) ? null : relative;
    }

    /** 应用层组装好的下载结果：业务建议的 zip 文件名 + 流式响应体。 */
    public static final class SkillZipDownload {
        private final String zipFileName;

        private final StreamingResponseBody body;

        private SkillZipDownload(String zipFileName, StreamingResponseBody body) {
            this.zipFileName = zipFileName;
            this.body = body;
        }

        public String getZipFileName() {
            return zipFileName;
        }

        public StreamingResponseBody getBody() {
            return body;
        }
    }
}
