package com.iwhalecloud.byai.state.application.service.session;

import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.storage.UserFS;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.state.domain.resource.qo.WorkspaceSkillCenterQo;
import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.io.InputStream;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.TreeMap;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** 工作空间技能向资源中心的单向同步：保存并绑定当前员工，提交后才清理未入库源目录。 */
@Service
public class WorkspaceSkillCenterApplicationService {
    private static final Logger LOGGER = LoggerFactory.getLogger(WorkspaceSkillCenterApplicationService.class);
    private final SsResourceService resources;
    private final SsResourceRelDetailService relations;
    private final AuthApplicationService auth;
    private final UserFS files;
    private final ByClawSkillPathResolver paths;
    private final ByClawSkillResourceApplicationService packages;
    private final TransactionTemplate transaction;

    public WorkspaceSkillCenterApplicationService(SsResourceService resources, AuthApplicationService auth,
        UserFS files, ByClawSkillPathResolver paths, ByClawSkillResourceApplicationService packages,
        PlatformTransactionManager transactionManager, SsResourceRelDetailService relations) {
        this.relations = relations;
        this.resources = resources;
        this.auth = auth;
        this.files = files;
        this.paths = paths;
        this.packages = packages;
        this.transaction = new TransactionTemplate(transactionManager);
        // 独立事务确保返回后已提交；串行化隔离防止不同员工同时创建同一个中心技能。
        this.transaction.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        this.transaction.setIsolationLevel(TransactionDefinition.ISOLATION_SERIALIZABLE);
    }

    public Status preview(WorkspaceSkillCenterQo request) {
        return inspect(request, false).status();
    }

    public Result sync(WorkspaceSkillCenterQo request) {
        Saved saved = transaction.execute(status -> {
            Inspection inspection = inspect(request, true);
            if (StringUtils.isBlank(request.getRevision())
                || !request.getRevision().equals(inspection.status().revision())) {
                throw failure("changed");
            }
            // 相同内容不执行写入，也不触发清理，避免过期按钮删除仍在使用的目录。
            if ("NONE".equals(inspection.status().action())) throw failure("unchanged");
            Map<String, byte[]> source = snapshot(inspection.path());
            if (!sameSnapshot(inspection.source(), source)) throw failure("changed");
            // 更新与安装都保存完整目录，避免附件差异一直存在、反复提示更新。
            byte[] bytes = inspection.existing() == null ? zip(inspection.name(), source)
                : packages.replaceCenterSkillFiles(inspection.targetPackage(), source);
            var result = packages.saveWorkspaceSkillCenterPackage(bytes, inspection.status().ownerType(),
                inspection.resourceCode(), inspection.name(), inspection.existing(), request.getResourceId());
            return new Saved(result.resource().getResourceId(), inspection, source);
        });
        if (saved == null) throw failure("failed");

        // 已安装技能仍由员工使用；更新资源包后保留工作目录和安装关联。
        if (request.getTargetResourceId() != null) {
            return new Result(saved.resourceId(), saved.inspection().status().action(), false);
        }
        boolean cleaned = false;
        try {
            // 存储没有数据库事务：若保存期间源文件发生变化，保留整个目录，避免删掉未同步的新文件。
            Map<String, byte[]> current = snapshot(saved.inspection().path());
            if (!sameSnapshot(saved.source(), current)) throw failure("changed");
            Boolean deleted = inUser(() -> files.delete(saved.inspection().path() + "/"));
            List<String> remaining = inUser(() -> files.list(saved.inspection().path() + "/", Integer.MAX_VALUE));
            cleaned = !Boolean.FALSE.equals(deleted) && (remaining == null || remaining.isEmpty());
        } catch (Exception e) {
            LOGGER.warn("技能已保存，源目录清理失败 resourceId={}, path={}", saved.resourceId(),
                saved.inspection().path(), e);
        }
        return new Result(saved.resourceId(), saved.inspection().status().action(), cleaned);
    }

    private Inspection inspect(WorkspaceSkillCenterQo request, boolean lock) {
        if (request == null || request.getResourceId() == null
            || CurrentUserHolder.getCurrentUserId() == null
            || StringUtils.isBlank(CurrentUserHolder.getCurrentUserCode())) throw failure("invalid");
        SsResource employee = lock ? resources.findByIdForUpdate(request.getResourceId())
            : resources.findById(request.getResourceId());
        if (employee == null || !"DIG_EMPLOYEE".equals(employee.getResourceBizType())
            || Objects.equals(employee.getResourceStatus(), ResourceStatus.DELETE.getNum())
            || !auth.hasResourceInstallTargetManagePermission(employee)) throw failure("permission");
        if (request.getTargetResourceId() != null) return inspectInstalled(request, lock);
        String owner = employee.getOwnerType();
        if ("personal_default".equals(owner)) owner = OwnerType.PERSONAL;
        if (!OwnerType.PERSONAL.equals(owner) && !OwnerType.ENTERPRISE.equals(owner)) throw failure("invalid");
        String path = normalizePath(request.getSkillPath(), request.getResourceId());
        String name = path.substring(path.lastIndexOf('/') + 1);
        Map<String, byte[]> source = snapshot(path);
        String scopedCode = scopedCode(owner, name);
        List<SsResource> matches = resources.getResourceListByCode(List.of(name, scopedCode));
        if (matches == null) matches = List.of();
        final String targetOwner = owner;
        // 企业查询覆盖所有企业技能；个人查询只匹配当前用户创建的个人技能。
        List<SsResource> targets = matches.stream().filter(Objects::nonNull)
            .filter(item -> "SKILL".equals(item.getResourceBizType()))
            .filter(item -> targetOwner.equals(item.getOwnerType()))
            .filter(item -> !Objects.equals(item.getResourceStatus(), ResourceStatus.DELETE.getNum()))
            .filter(item -> !OwnerType.PERSONAL.equals(targetOwner)
                || Objects.equals(item.getCreateBy(), CurrentUserHolder.getCurrentUserId()))
            .toList();
        if (targets.size() > 1) throw failure("ambiguous");
        SsResource existing = targets.isEmpty() ? null : targets.get(0);
        if (existing != null && lock) {
            existing = resources.findByIdForUpdate(existing.getResourceId());
            if (existing == null) throw failure("changed");
        }
        byte[] targetPackage = existing == null ? null : packages.readCenterSkillPackage(existing);
        String action = existing == null ? "INSTALL" : samePackage(source, targetPackage) ? "NONE" : "UPDATE";
        if (existing != null && !"NONE".equals(action)) packages.assertSkillManagePermission(existing);
        String revision = DigestUtils.sha256Hex(owner + ":" + request.getResourceId() + ":" + path + ":"
            + DigestUtils.sha256Hex(zip("skill", source)) + ":" + (existing == null ? "new" : existing.getResourceId()) + ":"
            + (targetPackage == null ? "" : DigestUtils.sha256Hex(targetPackage)));
        String code = existing == null ? (matches.isEmpty() ? name : scopedCode) : existing.getResourceCode();
        return new Inspection(new Status(action, owner, existing == null ? null : existing.getResourceId(), revision),
            path, name, code, source, existing, targetPackage);
    }

    /** 已绑定技能也比较员工目录与中心包，且始终更新实际绑定 ID，避免同名资源串写。 */
    private Inspection inspectInstalled(WorkspaceSkillCenterQo request, boolean lock) {
        Long targetId = request.getTargetResourceId();
        var bindings = relations.findByResourceId(request.getResourceId());
        if (bindings == null || bindings.stream().noneMatch(row -> targetId.equals(row.getRelResourceId()))) {
            throw failure("permission");
        }
        SsResource target = lock ? resources.findByIdForUpdate(targetId) : resources.findById(targetId);
        if (target == null || !"SKILL".equals(target.getResourceBizType())
            || Objects.equals(target.getResourceStatus(), ResourceStatus.DELETE.getNum())) throw failure("invalid");
        byte[] targetPackage = packages.readCenterSkillPackage(target);
        String name = packages.readCenterSkillDirectoryName(targetPackage, target.getResourceCode());
        String root = paths.resolveSkillRootPrefix(CurrentUserHolder.getCurrentUserCode(), request.getResourceId());
        String path = normalizePath(root + name, request.getResourceId());
        // 安装入库后源目录可能已清理；无目录副本属于正常状态，不再触发比较或错误重试。
        Map<String, byte[]> source = snapshot(path, true);
        String action = source.isEmpty() || samePackage(source, targetPackage) ? "NONE" : "UPDATE";
        if ("UPDATE".equals(action)) packages.assertSkillManagePermission(target);
        String revision = DigestUtils.sha256Hex(request.getResourceId() + ":" + targetId + ":" + path + ":"
            + DigestUtils.sha256Hex(zip("skill", source)) + ":" + DigestUtils.sha256Hex(targetPackage));
        return new Inspection(new Status(action, target.getOwnerType(), targetId, revision), path, name,
            target.getResourceCode(), source, target, targetPackage);
    }

    /**
     * 比较完整技能包的 MD5：统一根目录、文件顺序及 ZIP 时间戳，避免仅打包元数据不同就提示更新。
     * 文件相对路径及内容均参与比较，提交并发校验另用完整包的 SHA-256。
     */
    private boolean samePackage(Map<String, byte[]> source, byte[] target) {
        return target != null && DigestUtils.md5Hex(zip("skill", source))
            .equals(DigestUtils.md5Hex(zip("skill", packages.readCenterSkillFiles(target))));
    }

    private String scopedCode(String owner, String name) {
        String scope = OwnerType.PERSONAL.equals(owner) ? "personal:" + CurrentUserHolder.getCurrentUserId() : "enterprise";
        return "workspace-" + DigestUtils.sha256Hex(scope + ":" + name);
    }

    private String normalizePath(String value, Long employeeId) {
        String root = paths.resolveSkillRootPrefix(CurrentUserHolder.getCurrentUserCode(), employeeId);
        String path = StringUtils.removeEnd(StringUtils.trimToEmpty(value).replace('\\', '/').replaceAll("/+", "/"), "/");
        if (!path.startsWith(root)) throw failure("invalid");
        String child = path.substring(root.length());
        if (child.isBlank() || child.contains("/") || ".".equals(child) || "..".equals(child)) throw failure("invalid");
        return path;
    }

    private byte[] read(String path) {
        return inUser(() -> {
            try (InputStream input = files.read(path)) {
                if (input == null) throw failure("missing");
                return input.readAllBytes();
            } catch (IOException e) {
                throw failure("missing");
            }
        });
    }

    private Map<String, byte[]> snapshot(String path) {
        return snapshot(path, false);
    }

    private Map<String, byte[]> snapshot(String path, boolean allowAbsent) {
        String prefix = path + "/";
        List<String> keys = inUser(() -> files.list(prefix, Integer.MAX_VALUE));
        Map<String, byte[]> snapshot = new TreeMap<>();
        if (keys != null) {
            for (String key : keys) {
                if (key == null || key.endsWith("/")) continue;
                if (!key.startsWith(prefix)) throw failure("invalid");
                String relative = key.substring(prefix.length());
                if (Arrays.stream(relative.split("/")).anyMatch(part -> ".".equals(part) || "..".equals(part))) {
                    throw failure("invalid");
                }
                snapshot.put(relative, read(key));
            }
        }
        // 仅无文件时跳过：有残留文件却缺少 SKILL.md，或任何文件读取失败，仍应报错。
        if (allowAbsent && snapshot.isEmpty()) return snapshot;
        if (!snapshot.containsKey("SKILL.md")) throw failure("missing");
        return snapshot;
    }

    private boolean sameSnapshot(Map<String, byte[]> first, Map<String, byte[]> second) {
        return first.keySet().equals(second.keySet())
            && first.entrySet().stream().allMatch(entry -> Arrays.equals(entry.getValue(), second.get(entry.getKey())));
    }

    private byte[] zip(String name, Map<String, byte[]> source) {
        try (ByteArrayOutputStream bytes = new ByteArrayOutputStream(); ZipOutputStream zip = new ZipOutputStream(bytes)) {
            for (Map.Entry<String, byte[]> file : new TreeMap<>(source).entrySet()) {
                ZipEntry entry = new ZipEntry(name + "/" + file.getKey());
                entry.setTime(0L);
                zip.putNextEntry(entry);
                zip.write(file.getValue());
                zip.closeEntry();
            }
            zip.finish();
            return bytes.toByteArray();
        } catch (IOException e) {
            throw failure("failed");
        }
    }

    private <T> T inUser(java.util.function.Supplier<T> action) {
        return ByClawUserWorkspacePaths.withUserContext(CurrentUserHolder.getCurrentUserCode(), action::get);
    }

    private IllegalArgumentException failure(String suffix) {
        return new IllegalArgumentException(I18nUtil.get("byclaw.skill.center." + suffix));
    }

    public record Status(String action, String ownerType, Long targetResourceId, String revision) { }
    public record Result(Long resourceId, String action, boolean sourceDeleted) { }
    private record Inspection(Status status, String path, String name, String resourceCode, Map<String, byte[]> source,
                              SsResource existing, byte[] targetPackage) { }
    private record Saved(Long resourceId, Inspection inspection, Map<String, byte[]> source) { }
}
