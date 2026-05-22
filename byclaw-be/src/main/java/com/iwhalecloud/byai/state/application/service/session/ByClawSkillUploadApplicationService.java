package com.iwhalecloud.byai.state.application.service.session;

import java.io.ByteArrayInputStream;
import java.io.IOException;
import java.io.InputStream;
import java.net.URLConnection;
import java.util.ArrayList;
import java.util.List;
import java.util.Locale;
import java.util.Set;
import java.util.zip.ZipEntry;
import java.util.zip.ZipInputStream;

import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;

import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.session.dto.ByClawSkillDto;

/**
 * 用户工作空间 skill 上传应用服务。
 *
 * 校验范围（明确仅这两条，其它问题用静默忽略而不是抛错）：
 * 1. zip 文件大小 ≤ 50MB；
 * 2. zip 内必须有且仅有一个 SKILL.md（文件名忽略大小写）。
 *
 * 落盘规则（与 {@link ByClawSkillQueryApplicationService} 完全对齐）：
 * - bucket = byclaw-{userCode}（由 UserFS / UserBucketNameResolver 统一生成）；
 * - 对象前缀：数字员工走 /.openclaw/workspace-baiying-agent-{resourceId}/skills/，超级助手走 /.openclaw/workspace/skills/；
 * - skillName 取自 zip 中 SKILL.md 所在目录的最后一段；若 SKILL.md 在 zip 根，回退到 zip 文件名去扩展名；
 * - 写入文件名统一规范为 "SKILL.md"，保证 query 的大小写敏感匹配能识别。
 *
 * 覆盖语义：上传若同 skillName 已存在，先整体清空旧目录再写新内容。
 * 不在服务端保留 zip 本体；解压后逐 entry 流式写入 MinIO。
 *
 * @author qin.guoquan
 * @date 2026-05-15 18:37:18
 */
@Service
public class ByClawSkillUploadApplicationService {

    private static final Logger logger = LoggerFactory.getLogger(ByClawSkillUploadApplicationService.class);

    /** 服务端再设一道软限制（50MB），避免上传超大 zip 长时间阻塞 worker。 */
    private static final long MAX_ZIP_SIZE_BYTES = 50L * 1024 * 1024;

    /** SKILL.md 的规范文件名；query 服务用 case-sensitive 匹配，写入时统一规范化为该值。 */
    private static final String CANONICAL_SKILL_DOC_NAME = "SKILL.md";

    /** zip 解压时被判为噪音、直接跳过的顶层段。 */
    private static final Set<String> IGNORED_TOP_LEVEL_NAMES = Set.of("__MACOSX");

    private static final String IGNORED_FILE_DS_STORE = ".DS_Store";

    @Autowired
    private UserFS userFS;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 上传单个 skill zip。仅做大小、SKILL.md 唯一性两道校验，其它结构问题以静默忽略处理。
     *
     * @param userCode  目标用户编码（决定 bucket 名）
     * @param zipFile   前端上传的 zip MultipartFile
     * @return 与 query 接口同口径的 ByClawSkillDto
     */
    public ByClawSkillDto uploadSkillZip(String userCode, Long resourceId, MultipartFile zipFile) {
        validateInput(userCode, resourceId, zipFile);

        // 切换到目标用户上下文，bucket 解析与读写操作全程在切换后的 LoginInfo 下进行。
        return ByClawUserWorkspacePaths.withUserContext(userCode, () -> {
            // 桶不存在则创建；createBucketIfAbsent 是幂等操作，反复调用安全。
            userFS.init();

            // 一次性把 zip 全部 entry 解析到内存中（已被 50MB 总大小约束），便于：
            // 1. 先做整体校验（必须仅一个 SKILL.md），失败时不写半个 skill；
            // 2. 写入前先清空旧目录，最大化避免「写一半失败」的脏状态。
            List<ParsedEntry> entries = parseZipEntries(zipFile);
            ParsedEntry skillDocEntry = findUniqueSkillDoc(entries);
            String skillBaseInZip = parentDirOf(skillDocEntry.entryName);
            String skillName = resolveSkillName(skillBaseInZip, zipFile.getOriginalFilename());

            String skillRootPrefix = resolveSkillRootPrefix(resourceId);
            String skillRoot = skillRootPrefix + skillName;
            // 覆盖语义：清空旧目录再写，避免上一个版本的孤儿文件遗留。
            // 删除前缀本身是幂等的，桶 / 目录不存在时不会抛错。
            userFS.delete(skillRoot + "/");

            String skillDocObjectKey = null;
            int writtenCount = 0;
            for (ParsedEntry entry : entries) {
                // 仅写入 SKILL.md 同目录（递归）下的内容；zip 中 skill 目录之外的杂项 entry 一律忽略。
                if (!isUnderSkillBase(entry.entryName, skillBaseInZip)) {
                    continue;
                }
                String relative = relativizeUnderBase(entry.entryName, skillBaseInZip);
                // SKILL.md 文件名忽略大小写匹配，但写入时规范化为 "SKILL.md"，保证 query 能命中。
                String normalizedRelative = canonicalizeSkillDocCasing(relative);
                String objectKey = skillRoot + "/" + normalizedRelative;
                String contentType = guessContentType(normalizedRelative);
                try (InputStream in = new ByteArrayInputStream(entry.content)) {
                    userFS.write(in, entry.content.length, contentType, objectKey);
                }
                catch (IOException e) {
                    // ByteArrayInputStream 关闭不会抛 IOException，这里做兜底；转 IllegalStateException 让上层统一处理。
                    throw new IllegalStateException(I18nUtil.get("byclaw.fs.write.file.failed", objectKey), e);
                }
                if (CANONICAL_SKILL_DOC_NAME.equals(normalizedRelative)
                    || normalizedRelative.endsWith("/" + CANONICAL_SKILL_DOC_NAME)) {
                    skillDocObjectKey = objectKey;
                }
                writtenCount++;
            }
            logger.info("skill 上传完成, userCode={}, skillName={}, fileCount={}", userCode, skillName, writtenCount);
            return new ByClawSkillDto(skillName, skillRoot, skillDocObjectKey);
        });
    }

    /** 仅做硬性入参校验：userCode 非空、zip 非空、zip ≤ 50MB。 */
    private void validateInput(String userCode, Long resourceId, MultipartFile zipFile) {
        if (StringUtils.isBlank(userCode)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.user.code.notempty"));
        }
        if (zipFile == null || zipFile.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        if (zipFile.getSize() > MAX_ZIP_SIZE_BYTES) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.size.exceeded"));
        }
    }

    private String resolveSkillRootPrefix(Long resourceId) {
        if (resourceId == null) {
            return ByClawUserWorkspacePaths.WORKSPACE_SKILL_ROOT_PREFIX;
        }
        SsResource resource = ssResourceService.findById(resourceId);
        String resourceCode = resource == null ? null : resource.getResourceCode();
        return ByClawUserWorkspacePaths.resolveSkillRootPrefix(resourceId, resourceCode);
    }

    /**
     * 一次性解析 zip：跳过纯目录条目、噪音文件（__MACOSX/、.DS_Store）和路径穿越条目（含 ".."），
     * 把内容缓存到 byte[]。单文件大小已被 MAX_ZIP_SIZE_BYTES 整体约束，缓存到内存可控。
     */
    private List<ParsedEntry> parseZipEntries(MultipartFile zipFile) {
        List<ParsedEntry> result = new ArrayList<>();
        try (ZipInputStream zin = new ZipInputStream(zipFile.getInputStream())) {
            ZipEntry zipEntry;
            while ((zipEntry = zin.getNextEntry()) != null) {
                if (zipEntry.isDirectory()) {
                    continue;
                }
                String normalized = normalizeEntryName(zipEntry.getName());
                if (normalized == null) {
                    continue;
                }
                byte[] content = zin.readAllBytes();
                result.add(new ParsedEntry(normalized, content));
            }
        }
        catch (IOException e) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.read.failed"), e);
        }
        if (result.isEmpty()) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.empty"));
        }
        return result;
    }

    /**
     * 合规化 zip entry 名。返回 null 表示该 entry 应被忽略；返回非 null 表示一个合法相对路径。
     * 路径穿越（".."）这里直接静默丢弃，不抛错，符合"仅校验大小与 SKILL.md"的口径。
     */
    private String normalizeEntryName(String rawName) {
        if (StringUtils.isBlank(rawName)) {
            return null;
        }
        String normalized = rawName.replace('\\', '/').replaceAll("/+", "/");
        if (normalized.startsWith("/")) {
            normalized = normalized.substring(1);
        }
        if (StringUtils.isBlank(normalized)) {
            return null;
        }
        String[] segments = normalized.split("/");
        if (segments.length == 0) {
            return null;
        }
        if (IGNORED_TOP_LEVEL_NAMES.contains(segments[0])) {
            return null;
        }
        for (String seg : segments) {
            if ("..".equals(seg)) {
                return null;
            }
        }
        if (IGNORED_FILE_DS_STORE.equals(segments[segments.length - 1])) {
            return null;
        }
        return normalized;
    }

    /** 找出有且仅有一个 SKILL.md（文件名忽略大小写）。0 个或 ≥2 个都视为非法 zip。 */
    private ParsedEntry findUniqueSkillDoc(List<ParsedEntry> entries) {
        List<ParsedEntry> docs = new ArrayList<>();
        for (ParsedEntry entry : entries) {
            String basename = lastSegmentOf(entry.entryName);
            if (CANONICAL_SKILL_DOC_NAME.equalsIgnoreCase(basename)) {
                docs.add(entry);
            }
        }
        if (docs.size() != 1) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.missing.doc"));
        }
        return docs.get(0);
    }

    /**
     * 推导 skillName。
     * - SKILL.md 在 zip 子目录中：取该目录路径的最后一段（"outer/inner/SKILL.md" -> "inner"）；
     * - SKILL.md 在 zip 根：回退到 zip 文件名去扩展名（"fol-auto-biztravel.zip" -> "fol-auto-biztravel"）；
     *   两种来源都不能给出非空名时，统一按 "缺 SKILL.md" 报错（user 视角是 zip 不可用）。
     */
    private String resolveSkillName(String skillBaseInZip, String zipOriginalFilename) {
        String name;
        if (StringUtils.isEmpty(skillBaseInZip)) {
            name = stripFileExtension(lastPathSegment(zipOriginalFilename));
        }
        else {
            name = lastPathSegment(skillBaseInZip);
        }
        if (StringUtils.isBlank(name)) {
            throw new IllegalArgumentException(I18nUtil.get("byclaw.skill.zip.missing.doc"));
        }
        return name;
    }

    /** entryName 是否处于 skillBase（含递归子目录）下；skillBase 为空表示 zip 根，所有 entry 都视为在内。 */
    private boolean isUnderSkillBase(String entryName, String skillBaseInZip) {
        if (StringUtils.isEmpty(skillBaseInZip)) {
            return true;
        }
        return entryName.equals(skillBaseInZip) || entryName.startsWith(skillBaseInZip + "/");
    }

    /** 计算 entry 相对 skill 根目录的相对路径。 */
    private String relativizeUnderBase(String entryName, String skillBaseInZip) {
        if (StringUtils.isEmpty(skillBaseInZip)) {
            return entryName;
        }
        return entryName.substring(skillBaseInZip.length() + 1);
    }

    /**
     * 把相对路径中的 SKILL.md 文件名（任意大小写）规范化为 "SKILL.md"，
     * 让 {@link ByClawSkillQueryApplicationService} 的大小写敏感匹配能稳定命中。
     */
    private String canonicalizeSkillDocCasing(String relativePath) {
        int slash = relativePath.lastIndexOf('/');
        String basename = slash >= 0 ? relativePath.substring(slash + 1) : relativePath;
        if (!CANONICAL_SKILL_DOC_NAME.equalsIgnoreCase(basename)) {
            return relativePath;
        }
        return slash >= 0 ? relativePath.substring(0, slash + 1) + CANONICAL_SKILL_DOC_NAME : CANONICAL_SKILL_DOC_NAME;
    }

    private String parentDirOf(String entryName) {
        int slash = entryName.lastIndexOf('/');
        return slash > 0 ? entryName.substring(0, slash) : "";
    }

    private String lastSegmentOf(String entryName) {
        int slash = entryName.lastIndexOf('/');
        return slash >= 0 ? entryName.substring(slash + 1) : entryName;
    }

    /** 取路径最后一段；处理可能的反斜杠分隔（部分浏览器上传时 originalFilename 含完整路径）。 */
    private String lastPathSegment(String path) {
        if (StringUtils.isBlank(path)) {
            return "";
        }
        String normalized = path.replace('\\', '/');
        int slash = normalized.lastIndexOf('/');
        return slash >= 0 ? normalized.substring(slash + 1) : normalized;
    }

    /** 去掉文件名最后一个扩展名；保留多段点号中的前部分（如 "skill.v2.zip" -> "skill.v2"）。 */
    private String stripFileExtension(String filename) {
        if (StringUtils.isBlank(filename)) {
            return filename;
        }
        int dot = filename.lastIndexOf('.');
        return dot > 0 ? filename.substring(0, dot) : filename;
    }

    private String guessContentType(String entryName) {
        String guess = URLConnection.guessContentTypeFromName(entryName.toLowerCase(Locale.ROOT));
        return StringUtils.defaultIfBlank(guess, "application/octet-stream");
    }

    /** 解析后的 zip entry：路径已合规化，内容已加载到内存。 */
    private static final class ParsedEntry {
        private final String entryName;

        private final byte[] content;

        private ParsedEntry(String entryName, byte[] content) {
            this.entryName = entryName;
            this.content = content;
        }
    }
}
