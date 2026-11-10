package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.digitemploy.*;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.springframework.stereotype.Component;
import org.springframework.transaction.support.TransactionTemplate;

/** 显式事务：仅保存不调用员工更新/运行同步，生效仍复用原依赖授权与状态校验。 */
@Component
@RequiredArgsConstructor
public class EmployeeVersionCommands {
    private final SsResourceMapper resources;
    private final DigitalEmployeePublicationMapper locks;
    private final EmployeeVersionAccess access;
    private final EmployeeVersionStore store;
    private final DigitalEmployeeApplicationService employees;
    private final EmployeePublicationApplicationService publications;
    private final EmployeeVersionSync sync;
    private final EmployeeVersionLock mutex;
    private final TransactionTemplate transaction;

    public record Version(String id, long number, String name, String authorId, Date createdAt, String note,
        String source, String baseVersionId, boolean active, boolean latest, JSONObject configuration) { }
    public record History(String resourceId, String revision, String activeVersionId, String latestVersionId,
        boolean requiresReview, List<Version> versions, String syncStatus, String syncError) { }
    public record Result(String versionId, String revision, String status, String publicationId) { }

    public History history(Long resourceId, int page, int size) {
        return transaction.execute(status -> {
            SsResource resource = locked(resourceId);
            store.baseline(resource);
            var pending = store.pending(resource);
            return new History(id(resourceId), id(EmployeeVersionStore.revision(resource)), id(resource.getResourceRVerid()),
                id(resource.getResourceDVerid()), DigitalEmployeeGovernanceService.isOfficialCopy(resource),
                store.history(resource, page, size).stream().map(version -> view(resource, version, false)).toList(),
                pending == null ? "READY" : pending.getStatus(), pending == null ? null : pending.getErrorMessage());
        });
    }
    public Version detail(Long resourceId, Long versionId) {
        SsResource resource = resources.selectById(resourceId); access.requireManage(resource);
        return view(resource, store.requireVersion(resource, versionId), true);
    }
    public Result save(EmployeeVersionRequest request) {
        Result saved = transaction.execute(status -> {
            SsResource resource = locked(request.getResourceId());
            requireRequest(request);
            DigitalEmployeeDTO input = request.getEmployee();
            employees.validateVersionConfiguration(input);
            DigitalEmployeeDTO current = store.current(resource.getResourceId());
            if ("017".equals(current.getAgentType()) != "017".equals(input.getAgentType()))
                throw new BaseException("不能通过版本将员工组与普通员工相互转换");
            if ("FROM_THIRD".equals(current.getCreateType()) || resource.getThirdSyncRevision() != null && resource.getThirdSyncRevision() > 0)
                throw new BaseException("外部同步员工由来源系统维护配置，暂不支持本地版本覆盖");
            SsResourceVersion duplicate = store.savedRequest(resource, request.getRequestId());
            if (duplicate != null) {
                if (!Objects.equals(duplicate.getContentHash(), EmployeeVersionSnapshot.hash(EmployeeVersionSnapshot.encode(input))))
                    throw new BaseException("同一个保存请求不能提交不同配置，请重新保存");
                if (!Objects.equals(duplicate.getVersionSource(), request.isActivate() ? "EDIT_ACTIVATE" : "EDIT_SAVED"))
                    throw new BaseException("保存请求的生效方式不能改变，请使用新请求");
                return new Result(id(duplicate.getResourceVersionId()), id(duplicate.getSavedRevision()), "SAVED", null);
            }
            store.checkRevision(resource, request.getExpectedRevision());
            store.baseline(resource);
            SsResourceVersion version = store.append(resource, input, request.getBaseVersionId() == null
                ? resource.getResourceRVerid() : request.getBaseVersionId(), request.isActivate() ? "EDIT_ACTIVATE" : "EDIT_SAVED", request.getNote(), request.getRequestId(), null);
            return result(resource, version, "SAVED", null);
        });
        if (!request.isActivate()) return saved;
        EmployeeVersionRequest activation = new EmployeeVersionRequest();
        activation.setResourceId(request.getResourceId()); activation.setVersionId(Long.valueOf(saved.versionId()));
        activation.setExpectedRevision(Long.valueOf(saved.revision())); activation.setRequestId(request.getRequestId());
        activation.setNote(request.getNote());
        activation.setEmployee(request.getEmployee());
        try {
            return activate(activation);
        } catch (BaseException error) {
            throw new BaseException("版本已保存，但生效未完成：" + error.getMessage(), error);
        }
    }
    public Result activate(EmployeeVersionRequest request) {
        requireRequest(request);
        SsResource employee = resources.selectById(request.getResourceId()); access.requireManage(employee);
        if (employee.getThirdSyncRevision() != null && employee.getThirdSyncRevision() > 0
            || "FROM_THIRD".equals(store.current(employee.getResourceId()).getCreateType()))
            throw new BaseException("外部同步员工不能通过本地版本覆盖配置");
        if (DigitalEmployeeGovernanceService.isOfficialCopy(employee)) {
            if (Objects.equals(employee.getResourceRVerid(), request.getVersionId())) {
                store.requireVersion(employee, request.getVersionId());
                return status(employee.getResourceId(), id(request.getVersionId()));
            }
            var detail = publications.prepareVersionUpdate(request.getResourceId(), request.getVersionId(), request.getExpectedRevision(), request.getEmployee());
            return new Result(id(request.getVersionId()), id(EmployeeVersionStore.revision(resources.selectById(request.getResourceId()))),
                "REVIEW_REQUIRED", id(detail.publication().getRequestId()));
        }
        Result activated = transaction.execute(status -> {
            SsResource resource = locked(request.getResourceId());
            SsResourceVersion version = store.requireVersion(resource, request.getVersionId());
            var prior = store.activationRequest(resource, request.getRequestId());
            if (prior != null) {
                if (!Objects.equals(prior.getToVersionId(), request.getVersionId())) throw new BaseException("同一请求不能切换不同版本");
                return result(resource, version, Objects.equals(resource.getResourceRVerid(), version.getResourceVersionId()) ? "ACTIVE" : "SUPERSEDED", null);
            }
            if (Objects.equals(resource.getResourceRVerid(), version.getResourceVersionId())) return result(resource, version, "ACTIVE", null);
            store.checkRevision(resource, request.getExpectedRevision());
            DigitalEmployeeDTO configuration = EmployeeVersionSnapshot.restore(version.getExtInfo(), store.current(resource.getResourceId()));
            // 首次保存并生效可同步本次编辑的凭证；历史回退只使用当前凭证，历史表永不保存密钥。
            if (request.getEmployee() != null) {
                configuration.setMachineChannel(request.getEmployee().getMachineChannel());
                configuration.setMemoryConfigList(request.getEmployee().getMemoryConfigList());
                configuration.setFrontAccess(request.getEmployee().isFrontAccess());
            }
            employees.validateVersionConfiguration(configuration);
            employees.validateVersionDependencies(configuration);
            try (var context = new EmployeeVersionContext(version.getResourceVersionId(), request.getRequestId())) {
                // 现有更新链路逐项校验关联资源可用性/租户/使用权，禁止恢复失效依赖。
                employees.updateDigitalEmployee(configuration);
            }
            return result(resources.selectById(resource.getResourceId()), version, "ACTIVE", null);
        });
        // 提交之后同步；失败写入可重试记录，响应明确区分配置保存与运行态就绪。
        if ("SUPERSEDED".equals(activated.status())) return activated;
        sync.refresh(request.getResourceId());
        return status(request.getResourceId(), activated.versionId());
    }
    public Result retry(Long resourceId) {
        access.requireManage(resources.selectById(resourceId));
        sync.refresh(resourceId);
        return status(resourceId, id(resources.selectById(resourceId).getResourceRVerid()));
    }
    private Result status(Long resourceId, String versionId) {
        SsResource resource = resources.selectById(resourceId);
        var activation = store.pending(resource);
        return new Result(versionId, id(EmployeeVersionStore.revision(resource)),
            activation == null ? "ACTIVE" : activation.getStatus(), null);
    }
    private SsResource locked(Long resourceId) {
        mutex.acquire(CurrentUserHolder.getEnterpriseId(), resourceId);
        SsResource resource = locks.lockResource(resourceId, CurrentUserHolder.getEnterpriseId());
        access.requireManage(resource); return resource;
    }
    private static void requireRequest(EmployeeVersionRequest request) {
        if (request.getExpectedRevision() == null || request.getRequestId() == null || request.getRequestId().isBlank())
            throw new BaseException("请刷新页面后重试，版本修订号及请求标识不能为空");
    }
    private static Version view(SsResource resource, SsResourceVersion version, boolean includeConfiguration) {
        return new Version(id(version.getResourceVersionId()), version.getVersionSeq(), version.getResourceName(), id(version.getCreateBy()),
            version.getCreateTime(), version.getChangeNote(), version.getVersionSource(), id(version.getBaseVersionId()),
            Objects.equals(resource.getResourceRVerid(), version.getResourceVersionId()),
            Objects.equals(resource.getResourceDVerid(), version.getResourceVersionId()),
            includeConfiguration ? EmployeeVersionSnapshot.decode(version.getExtInfo()) : null);
    }
    private static Result result(SsResource resource, SsResourceVersion version, String status, String publicationId) {
        return new Result(id(version.getResourceVersionId()), id(EmployeeVersionStore.revision(resource)), status, publicationId);
    }
    private static String id(Long id) { return id == null ? null : id.toString(); }
}
