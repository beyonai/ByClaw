package com.iwhalecloud.byai.manager.application.service.resource;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeGovernanceService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtSkillService;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePublishScope;
import com.iwhalecloud.byai.manager.entity.resource.ResourcePublication;
import com.iwhalecloud.byai.manager.entity.resource.ResourcePublicationTarget;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.ResourcePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourcePublicationTargetMapper;
import com.iwhalecloud.byai.manager.mapper.resource.ResourcePublishScopeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** Organization publication changes catalog visibility only, never authorization or runtime bindings. */
@Service @RequiredArgsConstructor
public class ResourcePublicationService {
    private final ResourcePublicationMapper requests;
    private final ResourcePublicationTargetMapper targets;
    private final ResourcePublishScopeMapper scopes;
    private final SsResourceMapper resources;
    private final ResourcePublicationAccess access;
    private final AuthApplicationService auth;
    private final DigitalEmployeeGovernanceService governance;
    private final SsResExtSkillService skills;
    private final SequenceService sequence;

    public record Command(Long resourceId, Long requestId, Long revision, Long scopeRevision,
        String operation, ResourcePublishScope publishScope, String idempotencyKey,
        List<Long> targetOrgIds, Boolean approved, String comment) { }
    public record Target(ResourcePublicationTarget target, boolean canReview) { }
    public record Detail(ResourcePublication publication, List<Target> targets,
        String scopeMode, Long scopeRevision, String scopeController,
        List<ResourcePublicationAccess.OrganizationLabel> publishedScope,
        boolean canManage, boolean canSubmit, boolean canWithdraw, boolean canReview) { }
    public record Page(List<Detail> list, long total) { }

    private Long tenant() {
        Long tenant = CurrentUserHolder.getEnterpriseId();
        if (tenant == null || tenant <= 0 || CurrentUserHolder.getCurrentUserId() == null
            || CurrentUserHolder.getCurrentUserId() <= 0) throw new BaseException("请先选择有效企业并登录");
        return tenant;
    }
    private SsResource resource(Long id) {
        SsResource row = id == null ? null : resources.selectById(id);
        if (!ResourcePublicationAccess.supported(row) || !Objects.equals(row.getComAcctId(), tenant())
            || Objects.equals(row.getResourceStatus(), -1)) throw new BaseException("资源不存在、已注销或不属于当前企业");
        return row;
    }
    public boolean canManage(SsResource row) {
        return ResourcePublicationAccess.supported(row) && Objects.equals(row.getComAcctId(), CurrentUserHolder.getEnterpriseId())
            && !Objects.equals(row.getResourceStatus(), -1)
            && (Objects.equals(row.getCreateBy(), CurrentUserHolder.getCurrentUserId())
                || auth.isCurrentUserGlobalResourceManager() || auth.hasCurrentUserAllowManagePrivilege(row));
    }
    private void requireManage(SsResource row) {
        if (!canManage(row)) throw new BaseException("无权维护该资源的发布范围");
    }
    private ResourcePublication request(Long id) {
        ResourcePublication row = id == null ? null : requests.selectById(id);
        if (row == null || !Objects.equals(row.getTenantId(), tenant())) throw new BaseException("发布申请不存在");
        return row;
    }
    private List<ResourcePublicationTarget> targetRows(Long id) {
        return targets.selectList(new LambdaQueryWrapper<ResourcePublicationTarget>()
            .eq(ResourcePublicationTarget::getTenantId, tenant()).eq(ResourcePublicationTarget::getRequestId, id)
            .orderByAsc(ResourcePublicationTarget::getOrgId));
    }
    private ResourcePublication latest(Long id) {
        return requests.selectOne(new LambdaQueryWrapper<ResourcePublication>()
            .eq(ResourcePublication::getTenantId, tenant()).eq(ResourcePublication::getResourceId, id)
            .orderByDesc(ResourcePublication::getCreatedAt).orderByDesc(ResourcePublication::getRequestId).last("LIMIT 1"));
    }
    private ResourcePublication active(Long id) {
        return requests.selectOne(new LambdaQueryWrapper<ResourcePublication>()
            .eq(ResourcePublication::getTenantId, tenant()).eq(ResourcePublication::getResourceId, id)
            .in(ResourcePublication::getStatus, "DRAFT", "PENDING"));
    }
    private void expected(ResourcePublication row, Long revision) {
        if (!Objects.equals(row.getRevision(), revision)) throw new BaseException("发布申请已更新，请刷新后重试");
    }
    /** A compare-and-swap reserves this resource for this transaction; stale writers must retry. */
    private void reserve(SsResource row) {
        long old = Objects.requireNonNullElse(row.getPublishScopeRevision(), 0L);
        int changed = resources.update(null, new LambdaUpdateWrapper<SsResource>()
            .eq(SsResource::getResourceId, row.getResourceId()).eq(SsResource::getComAcctId, tenant())
            .eq(SsResource::getPublishScopeRevision, old).ne(SsResource::getResourceStatus, -1)
            .set(SsResource::getPublishScopeRevision, Math.addExact(old, 1)));
        if (changed != 1) throw new BaseException("发布范围已更新，请刷新后重试");
        row.setPublishScopeRevision(old + 1);
    }
    private void reserveRequest(ResourcePublication request, SsResource row) {
        if (!Objects.equals(request.getBaseScopeRevision(), row.getPublishScopeRevision()))
            throw new BaseException("发布范围已变化，请撤回并重新提交申请");
        reserve(row);
    }
    private void store(ResourcePublication row, SsResource resource) {
        row.setRevision(row.getRevision() + 1);
        row.setBaseScopeRevision(resource.getPublishScopeRevision());
        row.setUpdatedAt(new Date());
        requests.updateById(row);
    }
    private String scopeJson(Collection<Long> ids) {
        return JSON.toJSONString(ids.stream().map(String::valueOf).toList());
    }
    private String snapshot(SsResource row) {
        Map<String, Object> data = new LinkedHashMap<>();
        data.put("resourceId", row.getResourceId().toString()); data.put("resourceName", row.getResourceName());
        data.put("resourceDesc", row.getResourceDesc()); data.put("resourceBizType", row.getResourceBizType());
        data.put("resourceCode", row.getResourceCode()); data.put("version", row.getResourceVersionId());
        data.put("adminVipSource", protectedSource(row));
        if ("SKILL".equals(row.getResourceBizType())) {
            var skill = skills.findById(row.getResourceId());
            data.put("packageHash", skill == null ? null : skill.getSkillPackageHash());
        }
        return JSON.toJSONString(data);
    }
    private Long sourceResourceId(SsResource row) {
        ResourcePublication previous = latest(row.getResourceId());
        if (previous != null && previous.getSourceResourceId() != null) return previous.getSourceResourceId();
        if (row.getPublicationSourceId() != null) return row.getPublicationSourceId();
        if ("SKILL".equals(row.getResourceBizType())) {
            var skill = skills.findById(row.getResourceId());
            if (skill != null && StringUtils.isNotBlank(skill.getTargetContent()))
                return JSON.parseObject(skill.getTargetContent()).getLong("sourceResourceId");
        }
        return null;
    }
    private boolean protectedSource(SsResource row) {
        // Preserve the original review boundary even if the copy metadata or source is later removed.
        ResourcePublication previous = latest(row.getResourceId());
        if (previous != null && StringUtils.isNotBlank(previous.getReviewSnapshotJson())
            && JSON.parseObject(previous.getReviewSnapshotJson()).getBooleanValue("adminVipSource")) return true;
        Long sourceId = sourceResourceId(row);
        SsResource source = sourceId == null ? null : resources.selectById(sourceId);
        if (source != null && source.getCreateBy() != null && governance.isAdminVipCreator(source.getCreateBy())) return true;
        Long creator = row.getCreateBy();
        if ("SKILL".equals(row.getResourceBizType())) {
            var skill = skills.findById(row.getResourceId());
            if (skill != null && StringUtils.isNotBlank(skill.getTargetContent())) {
                var metadata = JSON.parseObject(skill.getTargetContent());
                if (metadata.containsKey("sourceCreatorId")) creator = metadata.getLong("sourceCreatorId");
            }
        }
        return creator != null && governance.isAdminVipCreator(creator);
    }
    private boolean canReview(SsResource resource, Long org) {
        return access.canReviewOrg(org) && (!protectedSource(resource) || CurrentUserHolder.isAdminVip());
    }
    /** A rejected/withdrawn unpublished personal snapshot may be recreated from the current source package. */
    public boolean canPrepareNewSkillSnapshot(Long id) {
        SsResource row = resource(id);
        if (!"SKILL".equals(row.getResourceBizType()) || !"NONE".equals(ResourcePublicationAccess.mode(row)) || !access.liveIds(id).isEmpty()) return false;
        ResourcePublication previous = latest(id);
        if (previous == null || !List.of("CLOSED", "WITHDRAWN").contains(previous.getStatus()) || "RETRACT".equals(previous.getOperation())) return false;
        List<ResourcePublicationTarget> history = targetRows(previous.getRequestId());
        return !history.isEmpty() && history.stream().noneMatch(t -> "APPROVED".equals(t.getStatus()) || "PENDING".equals(t.getStatus()));
    }

    public Detail detail(Long id) { return describe(request(id)); }
    public Detail current(Long id) {
        SsResource row = resource(id);
        ResourcePublication request = latest(id);
        if (request != null) return describe(request);
        requireManage(row);
        return new Detail(null, List.of(), ResourcePublicationAccess.mode(row), row.getPublishScopeRevision(),
            row.getPublishScopeController(), access.labels(access.liveIds(id)), true, false, false, false);
    }
    private Detail describe(ResourcePublication row) {
        SsResource resource = resource(row.getResourceId());
        boolean manage = canManage(resource);
        boolean applicant = Objects.equals(row.getApplicantId(), CurrentUserHolder.getCurrentUserId());
        List<ResourcePublicationTarget> all = targetRows(row.getRequestId());
        List<Target> visible = all.stream().filter(t -> manage || applicant || canReview(resource, t.getOrgId()))
            .map(t -> new Target(t, "PENDING".equals(row.getStatus()) && "PENDING".equals(t.getStatus()) && canReview(resource, t.getOrgId()))).toList();
        if (!manage && !applicant && ("DRAFT".equals(row.getStatus()) || visible.isEmpty())) throw new BaseException("无权查看发布申请");
        // Scoped reviewers must not receive the other organizations in the serialized request.
        ResourcePublication shown = row;
        if (!manage && !applicant && !access.administrator()) {
            shown = new ResourcePublication(); org.springframework.beans.BeanUtils.copyProperties(row, shown);
            shown.setBeforeScopeJson(null);
            shown.setRequestedScopeJson(scopeJson(visible.stream().map(t -> t.target().getOrgId()).toList()));
        }
        return new Detail(shown, visible, ResourcePublicationAccess.mode(resource), resource.getPublishScopeRevision(),
            resource.getPublishScopeController(), manage || applicant ? access.labels(access.liveIds(resource.getResourceId())) : List.of(),
            manage, manage && "DRAFT".equals(row.getStatus()), (manage || applicant) && List.of("DRAFT", "PENDING").contains(row.getStatus()),
            visible.stream().anyMatch(Target::canReview));
    }

    @Transactional(rollbackFor = Exception.class)
    public Detail prepare(Command command) {
        SsResource row = resource(command.resourceId()); requireManage(row);
        return describe(prepareInternal(row, command.operation(), command.publishScope(), command.idempotencyKey(), "UI"));
    }
    private ResourcePublication prepareInternal(SsResource row, String operation, ResourcePublishScope selected,
        String key, String source) {
        String idempotency = StringUtils.defaultIfBlank(key, UUID.randomUUID().toString());
        if (idempotency.length() > 128) throw new BaseException("幂等键过长");
        ResourcePublication same = requests.selectOne(new LambdaQueryWrapper<ResourcePublication>()
            .eq(ResourcePublication::getTenantId, tenant()).eq(ResourcePublication::getResourceId, row.getResourceId())
            .eq(ResourcePublication::getIdempotencyKey, idempotency));
        if (same != null) {
            if ((StringUtils.isNotBlank(operation) && !operation.equals(same.getOperation()))
                || (selected != null && !access.normalize(selected).equals(JSON.parseArray(same.getRequestedScopeJson(), Long.class))))
                throw new BaseException("幂等键已用于不同的发布请求");
            return same;
        }
        ResourcePublication pending = active(row.getResourceId());
        if (pending != null) {
            if (selected != null && !access.normalize(selected).equals(JSON.parseArray(pending.getRequestedScopeJson(), Long.class)))
                throw new BaseException("已有其他范围的发布申请，请先处理或撤回");
            return pending;
        }
        List<Long> live = access.liveIds(row.getResourceId());
        String action = StringUtils.defaultIfBlank(operation, live.isEmpty() ? "PUBLISH" : "ADD_SCOPE");
        if (!Set.of("PUBLISH", "ADD_SCOPE", "REPLACE_SCOPE").contains(action)) throw new BaseException("无效的发布操作");
        if ("PUBLISH".equals(action) && !live.isEmpty()) throw new BaseException("资源已发布，请增加组织或替换范围");
        List<Long> proposed = selected == null ? List.of() : access.normalize(selected);
        validateCombination(live, proposed, action);
        reserve(row);
        ResourcePublication request = new ResourcePublication();
        request.setRequestId(sequence.nextVal()); request.setTenantId(tenant()); request.setResourceId(row.getResourceId());
        request.setSourceResourceId(sourceResourceId(row)); request.setRequestSource(source); request.setOperation(action);
        request.setApplicantId(CurrentUserHolder.getCurrentUserId()); request.setApplicantName(CurrentUserHolder.getCurrentUserName());
        request.setReviewSnapshotJson(snapshot(row)); request.setResourceFingerprint(DigestUtils.sha256Hex(request.getReviewSnapshotJson()));
        request.setBeforeScopeJson(scopeJson(live)); request.setRequestedScopeJson(scopeJson(proposed));
        request.setStatus("DRAFT"); request.setRevision(0L); request.setBaseScopeRevision(row.getPublishScopeRevision());
        request.setIdempotencyKey(idempotency); request.setCreatedAt(new Date()); request.setUpdatedAt(new Date());
        requests.insert(request);
        return request;
    }
    private void validateCombination(List<Long> live, List<Long> requested, String operation) {
        if ("ADD_SCOPE".equals(operation) && !live.isEmpty() && !requested.isEmpty()
            && (live.contains(-1L) || requested.contains(-1L))) throw new BaseException("全公司与组织之间切换请使用替换范围");
    }
    @Transactional(rollbackFor = Exception.class)
    public Detail save(Command command) {
        ResourcePublication request = request(command.requestId()); expected(request, command.revision());
        SsResource row = resource(request.getResourceId()); requireManage(row);
        if (!"DRAFT".equals(request.getStatus())) throw new BaseException("仅草稿可修改发布范围");
        List<Long> ids = access.normalize(command.publishScope());
        validateCombination(access.liveIds(row.getResourceId()), ids, request.getOperation());
        reserveRequest(request, row); request.setRequestedScopeJson(scopeJson(ids));
        request.setReviewSnapshotJson(snapshot(row)); request.setResourceFingerprint(DigestUtils.sha256Hex(request.getReviewSnapshotJson()));
        store(request, row); return describe(request);
    }
    @Transactional(rollbackFor = Exception.class)
    public Detail submit(Command command) {
        ResourcePublication request = request(command.requestId()); expected(request, command.revision());
        SsResource row = resource(request.getResourceId()); requireManage(row);
        return describe(submitInternal(request, row));
    }
    private ResourcePublication submitInternal(ResourcePublication request, SsResource row) {
        if (!"DRAFT".equals(request.getStatus())) throw new BaseException("仅草稿可提交");
        List<Long> selected = JSON.parseArray(request.getRequestedScopeJson(), Long.class);
        selected = access.normalize(selected.equals(List.of(-1L)) ? ResourcePublishScope.company() : new ResourcePublishScope("ORGS", selected));
        List<Long> live = access.liveIds(row.getResourceId());
        validateCombination(live, selected, request.getOperation());
        if ("ADD_SCOPE".equals(request.getOperation())) selected = selected.stream().filter(id -> !live.contains(id)).toList();
        if (selected.isEmpty()) throw new BaseException("没有新增的发布组织");
        reserveRequest(request, row);
        Map<Long, String> labels = new HashMap<>(); access.labels(selected).forEach(o -> labels.put(Long.valueOf(o.orgId()), o.orgName()));
        for (Long org : selected) {
            ResourcePublicationTarget target = new ResourcePublicationTarget(); target.setTargetId(sequence.nextVal());
            target.setTenantId(tenant()); target.setRequestId(request.getRequestId()); target.setOrgId(org);
            target.setOrgNameSnapshot(labels.get(org)); target.setStatus("PENDING"); target.setRevision(0L); target.setCreatedAt(new Date());
            targets.insert(target);
        }
        if ("UI".equals(request.getRequestSource())) {
            resources.update(null, new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, row.getResourceId())
                .set(SsResource::getPublishScopeController, "BYAI")); row.setPublishScopeController("BYAI");
        }
        request.setRequestedScopeJson(scopeJson(selected)); request.setReviewSnapshotJson(snapshot(row));
        request.setResourceFingerprint(DigestUtils.sha256Hex(request.getReviewSnapshotJson()));
        request.setStatus("PENDING"); request.setSubmittedAt(new Date()); store(request, row); return request;
    }

    @Transactional(rollbackFor = Exception.class)
    public Detail review(Command command) {
        ResourcePublication request = request(command.requestId()); expected(request, command.revision());
        SsResource row = resource(request.getResourceId());
        if (!"PENDING".equals(request.getStatus()) || command.approved() == null) throw new BaseException("申请状态或审核决定无效");
        List<ResourcePublicationTarget> all = targetRows(request.getRequestId());
        Set<Long> selected = command.targetOrgIds() == null ? Set.of() : new HashSet<>(command.targetOrgIds());
        if (selected.isEmpty()) throw new BaseException("请选择审核组织");
        List<ResourcePublicationTarget> chosen = all.stream().filter(t -> selected.contains(t.getOrgId())).toList();
        if (chosen.size() != selected.size() || chosen.stream().anyMatch(t -> !"PENDING".equals(t.getStatus()) || !canReview(row, t.getOrgId())))
            throw new BaseException("部分组织已处理、已失效或无审核权限");
        reserveRequest(request, row);
        if (!Objects.equals(request.getResourceFingerprint(), DigestUtils.sha256Hex(snapshot(row)))) throw new BaseException("资源内容已变更，请撤回并重新提交审核");
        Date now = new Date();
        for (ResourcePublicationTarget target : chosen) {
            target.setStatus(command.approved() ? "APPROVED" : "REJECTED"); target.setRevision(target.getRevision() + 1);
            target.setReviewerId(CurrentUserHolder.getCurrentUserId()); target.setReviewerName(CurrentUserHolder.getCurrentUserName());
            target.setReviewedAt(now); target.setComment(StringUtils.left(command.comment(), 2000)); targets.updateById(target);
        }
        boolean replace = "REPLACE_SCOPE".equals(request.getOperation());
        boolean allApproved = all.stream().allMatch(t -> "APPROVED".equals(t.getStatus()));
        if ((!replace && command.approved()) || (replace && allApproved)) {
            List<Long> live = replace ? new ArrayList<>() : new ArrayList<>(access.liveIds(row.getResourceId()));
            all.stream().filter(t -> "APPROVED".equals(t.getStatus())).map(ResourcePublicationTarget::getOrgId).forEach(live::add);
            apply(row, request, live);
            for (ResourcePublicationTarget target : all) if ("APPROVED".equals(target.getStatus()) && target.getAppliedAt() == null) {
                target.setAppliedAt(now); targets.updateById(target);
            }
        }
        if (all.stream().noneMatch(t -> "PENDING".equals(t.getStatus()))) { request.setStatus("CLOSED"); request.setClosedAt(now); }
        store(request, row); return describe(request);
    }
    private void apply(SsResource row, ResourcePublication request, List<Long> selected) {
        List<Long> normalized = selected.isEmpty() ? List.of() : access.normalize(selected.contains(-1L)
            ? ResourcePublishScope.company() : new ResourcePublishScope("ORGS", selected));
        var existing = scopes.selectList(new LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope>()
            .eq(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getTenantId, tenant())
            .eq(com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope::getResourceId, row.getResourceId()));
        // Preserve the provenance and effective time of scopes that remain in force.
        existing.stream().filter(scope -> !normalized.contains(scope.getOrgId())).forEach(scope -> scopes.deleteById(scope.getScopeId()));
        Set<Long> retained = new HashSet<>(); existing.forEach(scope -> retained.add(scope.getOrgId()));
        for (Long org : normalized) {
            if (retained.contains(org)) continue;
            var scope = new com.iwhalecloud.byai.manager.entity.resource.ResourcePublishScope(); scope.setScopeId(sequence.nextVal());
            scope.setTenantId(tenant()); scope.setResourceId(row.getResourceId()); scope.setOrgId(org);
            scope.setRequestId(request.getRequestId()); scope.setEffectiveAt(new Date()); scopes.insert(scope);
        }
        String mode = normalized.isEmpty() ? "NONE" : normalized.contains(-1L) ? "COMPANY" : "ORGS";
        resources.update(null, new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, row.getResourceId()).set(SsResource::getPublishScopeMode, mode));
        row.setPublishScopeMode(mode);
    }
    @Transactional(rollbackFor = Exception.class)
    public Detail withdraw(Command command) {
        ResourcePublication request = request(command.requestId()); expected(request, command.revision());
        SsResource row = resource(request.getResourceId());
        if (!canManage(row) && !Objects.equals(request.getApplicantId(), CurrentUserHolder.getCurrentUserId())) throw new BaseException("无权撤回发布申请");
        if (!List.of("DRAFT", "PENDING").contains(request.getStatus())) throw new BaseException("申请已处理");
        reserveRequest(request, row); cancelPending(request); request.setStatus("WITHDRAWN"); request.setClosedAt(new Date()); store(request, row);
        return describe(request);
    }
    private void cancelPending(ResourcePublication request) {
        targets.update(null, new LambdaUpdateWrapper<ResourcePublicationTarget>()
            .eq(ResourcePublicationTarget::getTenantId, tenant()).eq(ResourcePublicationTarget::getRequestId, request.getRequestId())
            .eq(ResourcePublicationTarget::getStatus, "PENDING").set(ResourcePublicationTarget::getStatus, "CANCELLED").setSql("revision = revision + 1"));
    }
    @Transactional(rollbackFor = Exception.class)
    public Detail retract(Command command) {
        SsResource row = resource(command.resourceId()); requireManage(row);
        if (StringUtils.isNotBlank(command.idempotencyKey())) {
            ResourcePublication same = requests.selectOne(new LambdaQueryWrapper<ResourcePublication>()
                .eq(ResourcePublication::getTenantId, tenant()).eq(ResourcePublication::getResourceId, row.getResourceId())
                .eq(ResourcePublication::getIdempotencyKey, command.idempotencyKey()));
            if (same != null) {
                Set<Long> removed = new HashSet<>(JSON.parseArray(same.getBeforeScopeJson(), Long.class));
                removed.removeAll(JSON.parseArray(same.getRequestedScopeJson(), Long.class));
                if (!"RETRACT".equals(same.getOperation()) || command.targetOrgIds() == null || !removed.equals(new HashSet<>(command.targetOrgIds())))
                    throw new BaseException("幂等键已用于不同的撤销请求");
                return describe(same);
            }
        }
        if (!Objects.equals(row.getPublishScopeRevision(), command.scopeRevision())) throw new BaseException("发布范围已更新，请刷新");
        List<Long> before = access.liveIds(row.getResourceId());
        Set<Long> remove = command.targetOrgIds() == null ? Set.of() : new HashSet<>(command.targetOrgIds());
        if (remove.isEmpty() || !before.containsAll(remove)) throw new BaseException("请选择已生效的发布范围");
        ResourcePublication pending = active(row.getResourceId());
        if (pending != null) throw new BaseException("请先处理或撤回当前发布申请");
        ResourcePublication request = prepareInternal(row, "REPLACE_SCOPE", null, command.idempotencyKey(), "UI");
        request.setOperation("RETRACT"); request.setStatus("CLOSED"); request.setComment(StringUtils.left(command.comment(), 2000));
        List<Long> remaining = before.stream().filter(id -> !remove.contains(id)).toList();
        request.setRequestedScopeJson(scopeJson(remaining)); request.setClosedAt(new Date());
        apply(row, request, remaining);
        resources.update(null, new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, row.getResourceId()).set(SsResource::getPublishScopeController, "BYAI"));
        store(request, row); return describe(request);
    }

    /** Entry points call after resource persistence, inside their existing transaction. */
    @Transactional(rollbackFor = Exception.class)
    public void submitLocal(Long resourceId, ResourcePublishScope scope) {
        if (scope == null) return;
        SsResource row = resource(resourceId); requireManage(row);
        ResourcePublication request = prepareInternal(row, null, scope, null, "UI");
        if (!"DRAFT".equals(request.getStatus())) throw new BaseException("已有发布审核，不能覆盖其范围");
        if (!JSON.parseArray(request.getRequestedScopeJson(), Long.class).equals(access.normalize(scope))) throw new BaseException("已有不同范围的发布草稿，请从发布管理继续处理");
        submitInternal(request, row);
    }
    @Transactional(rollbackFor = Exception.class)
    public Map<String, Object> synchronize(Long resourceId, ResourcePublishScope scope, boolean created) {
        SsResource row = resource(resourceId);
        ResourcePublication previous = latest(resourceId);
        if (!created && scope == null) return syncResult(previous, row, "PRESERVED");
        if (!created && "BYAI".equals(row.getPublishScopeController())) return syncResult(previous, row, "IGNORED_LOCALLY_MANAGED");
        if (!auth.isCurrentUserGlobalResourceManager()) throw new BaseException("同步发布需要企业资源管理员身份");
        List<Long> desired = access.normalize(scope == null ? ResourcePublishScope.company() : scope);
        if (previous != null && desired.equals(JSON.parseArray(previous.getRequestedScopeJson(), Long.class))) return syncResult(previous, row, "UNCHANGED");
        if (created) resources.update(null, new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, resourceId)
            .set(SsResource::getPublishScopeController, "SYNC"));
        if (active(resourceId) != null) return syncResult(previous, row, "ACTIVE_REQUEST_EXISTS");
        String operation = access.liveIds(resourceId).isEmpty() ? "PUBLISH" : "REPLACE_SCOPE";
        ResourcePublication request = prepareInternal(row, operation, scope == null ? ResourcePublishScope.company() : scope,
            null, "SYNC");
        submitInternal(request, row); return syncResult(request, resource(resourceId), "SUBMITTED");
    }
    private Map<String, Object> syncResult(ResourcePublication request, SsResource row, String reason) {
        Map<String, Object> result = new LinkedHashMap<>(); result.put("reason", reason);
        result.put("scopeMode", ResourcePublicationAccess.mode(row));
        result.put("requestId", request == null ? null : request.getRequestId().toString());
        result.put("status", request == null ? null : request.getStatus()); return result;
    }

    public Page list(boolean review, int page, int size, List<String> resourceBizTypes) {
        tenant(); size = Math.min(Math.max(size, 1), 100); page = Math.max(page, 1);
        LambdaQueryWrapper<ResourcePublication> query = new LambdaQueryWrapper<ResourcePublication>().eq(ResourcePublication::getTenantId, tenant());
        if (review) {
            Set<Long> orgs = access.reviewOrgIds(); if (orgs.isEmpty()) return new Page(List.of(), 0);
            Set<Long> ids = new HashSet<>();
            targets.selectList(new LambdaQueryWrapper<ResourcePublicationTarget>().eq(ResourcePublicationTarget::getTenantId, tenant())
                .in(ResourcePublicationTarget::getOrgId, orgs)).forEach(t -> ids.add(t.getRequestId()));
            if (ids.isEmpty()) return new Page(List.of(), 0);
            query.in(ResourcePublication::getRequestId, ids).ne(ResourcePublication::getStatus, "DRAFT");
        } else query.eq(ResourcePublication::getApplicantId, CurrentUserHolder.getCurrentUserId());
        // Determine eligible resources before paging, including revoked protected-source privileges.
        Set<Long> candidateIds = new HashSet<>();
        requests.selectList(query).forEach(r -> candidateIds.add(r.getResourceId()));
        if (candidateIds.isEmpty()) return new Page(List.of(), 0);
        var resourceQuery = new LambdaQueryWrapper<SsResource>().in(SsResource::getResourceId, candidateIds)
            .eq(SsResource::getComAcctId, tenant()).eq(SsResource::getOwnerType, "enterprise")
            .ne(SsResource::getResourceStatus, -1).in(SsResource::getResourceBizType, ResourcePublicationAccess.TYPES);
        if (resourceBizTypes != null && !resourceBizTypes.isEmpty()) resourceQuery.in(SsResource::getResourceBizType, resourceBizTypes);
        List<Long> eligible = resources.selectList(resourceQuery).stream()
            .filter(r -> !review || !protectedSource(r) || CurrentUserHolder.isAdminVip() || canManage(r))
            .map(SsResource::getResourceId).toList();
        if (eligible.isEmpty()) return new Page(List.of(), 0);
        query.in(ResourcePublication::getResourceId, eligible).orderByDesc(ResourcePublication::getCreatedAt).orderByDesc(ResourcePublication::getRequestId);
        try (var pagination = PageHelper.startPage(page, size)) {
            List<ResourcePublication> rows = requests.selectList(query); long total = pagination.getTotal();
            PageHelper.clearPage();
            return new Page(rows.stream().map(this::describe).toList(), total);
        }
    }
    public Map<String, Long> pendingCounts() {
        Set<Long> orgs = access.reviewOrgIds(); if (orgs.isEmpty()) return Map.of();
        Map<Long, String> approvedRequests = new HashMap<>();
        for (var target : targets.selectList(new LambdaQueryWrapper<ResourcePublicationTarget>()
            .eq(ResourcePublicationTarget::getTenantId, tenant()).eq(ResourcePublicationTarget::getStatus, "PENDING")
            .in(ResourcePublicationTarget::getOrgId, orgs))) {
            ResourcePublication request = requests.selectById(target.getRequestId());
            SsResource row = request == null ? null : resources.selectById(request.getResourceId());
            if (ResourcePublicationAccess.supported(row) && Objects.equals(request.getTenantId(), tenant())
                && Objects.equals(row.getComAcctId(), tenant()) && !Objects.equals(row.getResourceStatus(), -1)
                && "PENDING".equals(request.getStatus()) && canReview(row, target.getOrgId()))
                approvedRequests.put(request.getRequestId(), row.getResourceBizType());
        }
        return approvedRequests.values().stream().collect(java.util.stream.Collectors.groupingBy(v -> v, java.util.stream.Collectors.counting()));
    }
    public long pendingCount() { return pendingCounts().values().stream().mapToLong(Long::longValue).sum(); }
}
