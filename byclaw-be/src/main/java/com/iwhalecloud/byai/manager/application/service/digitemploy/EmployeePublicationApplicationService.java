package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.resource.DigitalEmployType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationResources.Dependency;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventPublisher;
import com.iwhalecloud.byai.manager.application.service.digitemploy.event.DigEmployeeChangeEventType;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceRuntimeInfoResolver;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDetailsDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeePublicationRequest;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.entity.resource.DigitalEmployeePublication;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.DigitalEmployeePublicationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import lombok.RequiredArgsConstructor;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.support.TransactionTemplate;

/** Separate candidate and live versions. Every transition is serialized and revision checked.
 * @author qin.guoquan
 * @date 2026-09-27 22:38:38
 * */
@Service
@lombok.extern.slf4j.Slf4j
@RequiredArgsConstructor
public class EmployeePublicationApplicationService {
    // 服务端保存的更新对照信息，不接受员工 DTO 回传，不参与员工运行配置。
    private static final String UPDATE_TARGET = "_publicationUpdateTarget";
    private final DigitalEmployeePublicationMapper publications;
    private final SsResourceMapper resources;
    private final DigitalEmployeeGovernanceService governance;
    private final DigitalEmployeeApplicationService employees;
    private final EmployeePublicationResources dependencies;
    private final SsResExtDigEmployeeService extensions;
    private final SsResourceRelDetailService relations;
    private final ResourceRuntimeInfoResolver runtimeResolver;
    private final AuthApplicationService auth;
    private final SequenceService sequence;
    private final TransactionTemplate transaction;
    private final DigEmployeeChangeEventPublisher events;

    public Map<String, Boolean> capabilities() {
        boolean enabled = governance.publicationEnabled();
        return Map.of("enabled", enabled, "administrator", enabled && DigitalEmployeeGovernanceService.isAdministrator(),
            "canCreateEnterprise", DigitalEmployeeGovernanceService.isAdministrator());
    }

    public record DependencyView(String resourceId, String name, String action, String error, String warning,
        String resourceType, String availabilityScope, String reason, String impact) { }
    public record ReviewResult(String requestId, String reviewerName, Date reviewedAt, String comment) { }
    public record UpdateTarget(String resourceId, String name, boolean fromPersonal, boolean changed) { }
    public record Detail(DigitalEmployeePublication publication, DigitalEmployeeDetailsDTO employee,
        List<DependencyView> dependencies, boolean canEdit, boolean canSubmit, boolean canReview, boolean canWithdraw,
        boolean canRevise, ReviewResult previousReview, UpdateTarget updateTarget) { }
    public record Page(List<DigitalEmployeePublication> list, long total) { }

    public long pendingCount() {
        if (!governance.publicationEnabled() || !DigitalEmployeeGovernanceService.isAdministrator()
            || CurrentUserHolder.getEnterpriseId() == null) return 0;
        var query = new LambdaQueryWrapper<DigitalEmployeePublication>()
            .eq(DigitalEmployeePublication::getTenantId, CurrentUserHolder.getEnterpriseId())
            .in(DigitalEmployeePublication::getStatus, "PENDING", "FAILED");
        if (CurrentUserHolder.isAdminVip()) return publications.selectCount(query);
        query.select(DigitalEmployeePublication::getTenantId, DigitalEmployeePublication::getSourceId,
            DigitalEmployeePublication::getOfficialId, DigitalEmployeePublication::getAuthorId,
            DigitalEmployeePublication::getStatus, DigitalEmployeePublication::getUpdatedAt,
            DigitalEmployeePublication::getDependenciesJson);
        return publications.selectList(query).stream().filter(this::canReview).count();
    }

    public Page list(boolean review, int page, int size) {
        Long tenant = requireEnabled();
        if (review && !DigitalEmployeeGovernanceService.isAdministrator()) throw new BaseException("仅官方管理员可审核发布申请");
        var query = new LambdaQueryWrapper<DigitalEmployeePublication>().eq(DigitalEmployeePublication::getTenantId, tenant);
        if (!review) query.eq(DigitalEmployeePublication::getAuthorId, CurrentUserHolder.getCurrentUserId());
        long total = publications.selectCount(query);
        int limit = Math.max(1, Math.min(size, 100));
        query.orderByDesc(DigitalEmployeePublication::getUpdatedAt).last("limit " + limit + " offset " + (Math.max(0, page - 1) * (long) limit));
        List<DigitalEmployeePublication> rows = publications.selectList(query);
        rows.forEach(publication -> {
            publication.setRequiresAdminVipReview(requiresAdminVipReview(publication));
            publication.setCanReview(canReview(publication));
        });
        return new Page(rows, total);
    }

    public Detail detail(Long id) {
        requireEnabled();
        DigitalEmployeePublication publication = publications.selectById(id);
        requireView(publication);
        return view(publication);
    }

    /** 确认前重新检查依赖，但不保存、不提交，也不改变申请状态和修订号。 */
    public Detail preview(EmployeePublicationRequest request) {
        requireEnabled();
        return transaction.execute(status -> {
            DigitalEmployeePublication stored = locked(request);
            if ("DRAFT".equals(stored.getStatus())) requireEditable(stored);
            else {
                requireReviewer(stored);
                if (!canReview(stored)) throw new BaseException("当前申请状态不允许发布，请刷新后再操作");
            }
            DigitalEmployeePublication candidate = new DigitalEmployeePublication();
            // 配置快照对接口序列化隐藏，不能通过 JSON 往返复制；字符串字段独立赋值即可隔离预览修改。
            BeanUtils.copyProperties(stored, candidate);
            validateCandidate(candidate);
            return view(candidate);
        });
    }

    /** 只读打开当前申请；查看审核结果不得隐式创建草稿。 */
    public Detail current(Long resourceId) {
        Long tenant = requireEnabled();
        SsResource requested = requireEntryResource(resourceId, tenant);
        Long sourceId = DigitalEmployeeGovernanceService.isOfficialCopy(requested) ? requested.getPublicationSourceId() : resourceId;
        DigitalEmployeePublication current = publications.current(sourceId, tenant);
        if (current == null) return null;
        requireView(current);
        return view(current);
    }

    private SsResource requireEntryResource(Long resourceId, Long tenant) {
        SsResource requested = resources.selectById(resourceId);
        if (requested == null || !Objects.equals(tenant, requested.getComAcctId())) throw new BaseException("数字员工不存在");
        requireEmployee(requested);
        boolean official = DigitalEmployeeGovernanceService.isOfficialCopy(requested);
        if (official ? !governance.canMaintainOfficial(requested)
            : !Objects.equals(requested.getCreateBy(), CurrentUserHolder.getCurrentUserId())
                && !DigitalEmployeeGovernanceService.isAdministrator()) {
            throw new BaseException("只能发布自己创建的个人数字员工，或维护有权限的官方副本");
        }
        if (!official && !"personal".equals(requested.getOwnerType())) throw new BaseException("仅个人数字员工支持发布");
        return requested;
    }

    public java.io.InputStream skillSnapshot(Long requestId, Long resourceId) {
        requireEnabled();
        DigitalEmployeePublication publication = publications.selectById(requestId);
        requireView(publication);
        return dependencies.openSnapshot(dependencyList(publication), resourceId);
    }

    public Detail prepare(Long resourceId) {
        return prepare(resourceId, false);
    }

    /** 只有个人卡片上明确的“发布更新”操作才读取 A 的当前配置建立 B 的更新草稿。 */
    public Detail prepareUpdate(Long resourceId) {
        return prepare(resourceId, true);
    }

    private Detail prepare(Long resourceId, boolean fromPersonalUpdate) {
        Long tenant = requireEnabled();
        return transaction.execute(status -> {
            SsResource requested = requireEntryResource(resourceId, tenant);
            boolean official = DigitalEmployeeGovernanceService.isOfficialCopy(requested);
            if (fromPersonalUpdate && official) throw new BaseException("请从原个人员工发起发布更新");
            Long sourceId = official ? requested.getPublicationSourceId() : resourceId;
            if (!Objects.equals(requested.getResourceStatus(), 2)) throw new BaseException("仅在用数字员工支持发起发布或更新");
            // A stable source row serializes initial publication and official-update requests.
            publications.lockResource(sourceId, tenant);
            requested = publications.lockResource(resourceId, tenant);
            DigitalEmployeePublication active = publications.active(sourceId, tenant);
            if (active != null) { requireView(active); return view(active); }
            DigitalEmployeePublication latest = publications.current(sourceId, tenant);
            if (latest != null && (!official && !fromPersonalUpdate || !"PUBLISHED".equals(latest.getStatus()))) {
                requireView(latest);
                return view(latest);
            }
            SsResource existing = publications.official(sourceId, tenant);
            if (fromPersonalUpdate && existing == null) throw new BaseException("尚无官方副本，请先发布到官方推荐");
            if (!official && !fromPersonalUpdate && existing != null) throw new BaseException("该员工已有官方副本，请从个人员工卡片发起发布更新");
            SsResource target = official ? requested : fromPersonalUpdate ? existing : null;
            if (target != null) {
                target = publications.lockResource(target.getResourceId(), tenant);
                requireUpdateTarget(target, sourceId, tenant);
            }
            DigitalEmployeeDTO snapshot = sanitize(readConfiguration(resourceId), target == null ? requested : target);
            // 更新沿用 B 的名称，个人名称修改不会自动重命名企业副本。
            if (fromPersonalUpdate) snapshot.setResourceName(target.getResourceName());
            DigitalEmployeePublication publication = new DigitalEmployeePublication();
            publication.setRequestId(sequence.nextVal());
            publication.setTenantId(requested.getComAcctId());
            publication.setSourceId(sourceId);
            publication.setAuthorId(requested.getCreateBy());
            // Attribution follows the original resource creator, never the reviewing administrator.
            publication.setAuthorName(StringUtils.defaultIfBlank(publications.creatorName(requested.getCreateBy()), String.valueOf(requested.getCreateBy())));
            publication.setOfficialId(target == null ? null : target.getResourceId());
            publication.setStatus("DRAFT");
            publication.setRevision(1L);
            publication.setCreatedAt(new Date());
            setSnapshot(publication, snapshot);
            if (target != null) captureUpdateTarget(publication, target, fromPersonalUpdate);
            publications.insert(publication);
            return view(publication);
        });
    }

    public Detail revise(EmployeePublicationRequest request) {
        Long tenant = requireEnabled();
        return transaction.execute(status -> {
            DigitalEmployeePublication previous = locked(request);
            requireState(previous, "REJECTED", "WITHDRAWN");
            publications.lockResource(previous.getSourceId(), tenant);
            DigitalEmployeePublication active = publications.active(previous.getSourceId(), tenant);
            if (active != null) { requireView(active); return view(active); }
            DigitalEmployeePublication current = publications.current(previous.getSourceId(), tenant);
            if (current == null || !Objects.equals(current.getRequestId(), previous.getRequestId())) {
                throw new BaseException("该申请已有后续记录，请从员工列表查看最新申请");
            }
            DigitalEmployeePublication next = new DigitalEmployeePublication();
            next.setRequestId(sequence.nextVal());
            next.setSourceId(previous.getSourceId());
            next.setTenantId(tenant);
            next.setAuthorId(previous.getAuthorId());
            next.setAuthorName(previous.getAuthorName());
            SsResource official = publications.official(previous.getSourceId(), tenant);
            if (official != null) {
                official = publications.lockResource(official.getResourceId(), tenant);
                requireUpdateTarget(official, previous.getSourceId(), tenant);
            }
            next.setOfficialId(official == null ? null : official.getResourceId());
            next.setStatus("DRAFT"); next.setRevision(1L); next.setCreatedAt(new Date());
            setSnapshot(next, sanitize(JSON.parseObject(previous.getSnapshotJson(), DigitalEmployeeDTO.class), basis(next)));
            if (official != null) captureUpdateTarget(next, official, isFromPersonal(previous));
            publications.insert(next);
            return view(next);
        });
    }

    public Detail save(EmployeePublicationRequest request) {
        requireEnabled();
        return transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            requireEditable(publication);
            SsResource basis = basis(publication);
            DigitalEmployeeDTO snapshot = sanitize(request.getEmployee(), basis);
            setSnapshot(publication, snapshot);
            advance(publication);
            return view(publication);
        });
    }

    /** 显式刷新对照版本，只保留候选配置；用户仍需重新确认提交或审核。 */
    public Detail refreshTarget(EmployeePublicationRequest request) {
        Long tenant = requireEnabled();
        return transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            if ("FAILED".equals(publication.getStatus())) {
                requireReviewer(publication);
            } else {
                requireEditable(publication);
            }
            if (publication.getOfficialId() == null) throw new BaseException("当前申请不是官方员工更新");
            SsResource target = publications.lockResource(publication.getOfficialId(), tenant);
            requireUpdateTarget(target, publication.getSourceId(), tenant);
            captureUpdateTarget(publication, target, isFromPersonal(publication));
            advance(publication);
            return view(publication);
        });
    }

    public Detail submit(EmployeePublicationRequest request) {
        requireEnabled();
        Detail result = transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            requireState(publication, "DRAFT");
            requireEditable(publication);
            requireUnchangedUpdateTarget(publication);
            validateCandidate(publication);
            publication.setStatus("PENDING");
            publication.setComment(null);
            advance(publication);
            return view(publication);
        });
        if (canReview(result.publication())) {
            EmployeePublicationRequest auto = new EmployeePublicationRequest();
            auto.setRequestId(result.publication().getRequestId());
            auto.setRevision(result.publication().getRevision());
            auto.setComment("管理员发布，免人工审核");
            return approve(auto);
        }
        return result;
    }

    public Detail withdraw(EmployeePublicationRequest request) {
        requireEnabled();
        return transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            requireState(publication, "DRAFT", "PENDING", "FAILED");
            if (!Objects.equals(publication.getAuthorId(), CurrentUserHolder.getCurrentUserId())
                && !DigitalEmployeeGovernanceService.isAdministrator()) throw new BaseException("无权撤回此申请");
            publication.setStatus("WITHDRAWN");
            advance(publication);
            return view(publication);
        });
    }

    public Detail reject(EmployeePublicationRequest request) {
        requireEnabled();
        return transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            requireReviewer(publication);
            requireState(publication, "PENDING", "FAILED");
            if (StringUtils.isBlank(request.getComment())) throw new BaseException("请填写驳回原因");
            reviewStamp(publication, request.getComment());
            publication.setStatus("REJECTED");
            advance(publication);
            return view(publication);
        });
    }

    public Detail approve(EmployeePublicationRequest request) {
        Long tenant = requireEnabled();
        // Perform authorization before entering the failure handler: forbidden actions never change state.
        DigitalEmployeePublication checked = publications.selectById(request.getRequestId());
        requireView(checked);
        requireReviewer(checked);
        if ("PUBLISHED".equals(checked.getStatus())) return view(checked);
        // Reserve the attempt durably before external I/O. A rolled-back attempt remains APPLYING
        // until compensation completes, so another reviewer cannot publish over that compensation.
        Long leaseRevision = transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            requireReviewer(publication);
            boolean abandoned = "APPLYING".equals(publication.getStatus()) && publication.getUpdatedAt() != null
                && publication.getUpdatedAt().before(new Date(System.currentTimeMillis() - 10 * 60_000L));
            if (!abandoned) requireState(publication, "PENDING", "FAILED");
            publication.setStatus("APPLYING");
            advance(publication);
            return publication.getRevision();
        });
        request.setRevision(leaseRevision);
        Long[] attemptedOfficial = new Long[1];
        boolean[] runtimeAttempted = new boolean[1];
        try {
            return transaction.execute(status -> {
                DigitalEmployeePublication publication = locked(request);
                requireReviewer(publication);
                requireState(publication, "APPLYING");
                SsResource source = publications.lockResource(publication.getSourceId(), tenant);
                requireEmployee(source);
                if (!Objects.equals(source.getComAcctId(), publication.getTenantId())) {
                    throw new BaseException("发布申请与原员工的企业归属不一致");
                }
                validateCandidate(publication);
                requireReviewer(publication);
                SsResource official = publications.official(publication.getSourceId(), tenant);
                boolean fresh = official == null;
                if (!fresh) official = publications.lockResource(official.getResourceId(), tenant);
                if (!fresh && (official == null || !Objects.equals(official.getComAcctId(), source.getComAcctId()))) {
                    throw new BaseException("官方副本与原员工的企业归属不一致");
                }
                if (!fresh && !Objects.equals(official.getResourceStatus(), 2)) throw new BaseException("官方副本已下架或注销，请先处理其状态");
                if (publication.getOfficialId() != null) {
                    if (fresh || !Objects.equals(publication.getOfficialId(), official.getResourceId())) throw new BaseException("官方副本已变化，请重新发起更新");
                    requireUnchangedUpdateTarget(publication, official);
                }
                DigitalEmployeeDTO snapshot = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
                if (fresh) {
                    official = new SsResource();
                    official.setResourceId(sequence.nextVal());
                    official.setResourceCode("official-employee-" + official.getResourceId());
                    official.setCreateBy(publication.getAuthorId());
                    official.setCreateTime(new Date());
                    official.setComAcctId(source.getComAcctId());
                    official.setResourceBizType("DIG_EMPLOYEE");
                    official.setResourceType("COMBIN");
                    official.setSystemCode("BYAI");
                    official.setOwnerType("enterprise");
                    official.setManUserId(String.valueOf(publication.getAuthorId()));
                    official.setManOrgId(dependencies.audienceRoots(tenant).getFirst());
                    official.setPublicationSourceId(publication.getSourceId());
                    official.setResourceDVerid(1L);
                    official.setResourceRVerid(0L);
                }
                attemptedOfficial[0] = official.getResourceId();
                var nameQuery = new LambdaQueryWrapper<SsResource>().eq(SsResource::getComAcctId, tenant)
                    .eq(SsResource::getOwnerType, "enterprise").eq(SsResource::getResourceBizType, "DIG_EMPLOYEE")
                    .eq(SsResource::getResourceName, snapshot.getResourceName()).ne(SsResource::getResourceStatus, -1)
                    .ne(SsResource::getResourceId, official.getResourceId());
                if (resources.selectCount(nameQuery) > 0) throw new BaseException("官方推荐中已存在同名员工，请修改待发布名称");
                applyBasic(snapshot, official);
                official.setResourceStatus(2);
                official.setPublishType("publish");
                official.setPublishTime(new Date());
                official.setShelfTime(new Date());
                official.setPublicationRequestId(publication.getRequestId());
                official.setUpdateBy(CurrentUserHolder.getCurrentUserId());
                official.setUpdateTime(new Date());
                SsResource original = basis(publication);
                if ("HARNESS".equalsIgnoreCase(original.getWorkerAgentType())) {
                    official.setImplType("ASK_AGENT");
                    official.setWorkerAgentType("HARNESS");
                } else {
                    runtimeResolver.fillResource(official, runtimeResolver.resolveDigitalEmployee(snapshot.getAgentType(), official.getResourceId(), official.getResourceCode()));
                }
                if (fresh) resources.insert(official); else resources.updateById(official);
                List<Dependency> publishedDependencies = dependencyList(publication);
                Map<Long, Long> mapped = dependencies.materialize(publishedDependencies, tenant, official.getResourceId());
                snapshot.setResourceId(official.getResourceId());
                snapshot.setOwnerType("enterprise");
                snapshot.setResourceCode(official.getResourceCode());
                dependencies.applyPublishedResources(snapshot, publishedDependencies, mapped);
                publication.setDependenciesJson(JSON.toJSONString(publishedDependencies));
                replaceRelations(official, snapshot);
                SsResExtDigEmployee extension = new SsResExtDigEmployee();
                BeanUtils.copyProperties(snapshot, extension);
                if (!fresh) extensions.removeById(official.getResourceId());
                extensions.save(extension);
                if (fresh) {
                    auth.ensureCreatorDefaultPrivileges(official);
                    dependencies.grantAudience(official, tenant);
                }
                runtimeAttempted[0] = true;
                if (!employees.syncPublicationOpenClawWorkSpace(official.getResourceId(), snapshot)) throw new BaseException("官方员工运行配置同步失败，请重试发布");
                publication.setOfficialId(official.getResourceId());
                publication.setStatus("PUBLISHED");
                publication.setPublishError(null);
                reviewStamp(publication, request.getComment());
                advance(publication);
                auth.invalidateResourceAuthorizationCachesAfterCommit(official.getResourceId(), "DIG_EMPLOYEE");
                events.publishAfterCommitOrNow(fresh ? DigEmployeeChangeEventType.DIG_EMPLOYEE_CREATED : DigEmployeeChangeEventType.DIG_EMPLOYEE_UPDATED, official.getResourceId());
                return view(publication);
            });
        } catch (RuntimeException failure) {
            log.error("数字员工发布失败，requestId={}", request.getRequestId(), failure);
            // The DB transaction has rolled back. Restore the committed runtime mirror if one was touched.
            return transaction.execute(status -> {
                DigitalEmployeePublication publication = publications.lock(request.getRequestId(), tenant);
                if (publication == null || !Objects.equals(publication.getRevision(), request.getRevision())
                    || !"APPLYING".equals(publication.getStatus())) throw failure;
                if (runtimeAttempted[0]) {
                    try {
                        employees.restorePublicationRuntimeAfterRollback(attemptedOfficial[0]);
                    } catch (RuntimeException restoreFailure) {
                        log.error("恢复发布前运行配置失败，requestId={}, officialId={}", request.getRequestId(), attemptedOfficial[0], restoreFailure);
                    }
                }
                publication.setStatus("FAILED");
                publication.setPublishError(StringUtils.left(failure instanceof BaseException ? failure.getMessage() : "发布执行失败，请联系管理员检查服务日志后重试", 1800));
                reviewStamp(publication, request.getComment());
                advance(publication);
                return view(publication);
            });
        }
    }

    private void replaceRelations(SsResource official, DigitalEmployeeDTO snapshot) {
        relations.remove(new LambdaQueryWrapper<SsResourceRelDetail>().eq(SsResourceRelDetail::getResourceId, official.getResourceId()));
        for (Long id : snapshot.getRelIds()) {
            SsResourceRelDetail relation = new SsResourceRelDetail();
            relation.setResourceRelDetailId(sequence.nextVal());
            relation.setResourceId(official.getResourceId());
            relation.setRelResourceId(id);
            relation.setCreateBy(CurrentUserHolder.getCurrentUserId());
            relation.setCreateTime(new Date());
            relation.setComAcctId(official.getComAcctId());
            relation.setRelStatus(1);
            snapshot.getRelResourceInfoList().stream().filter(info -> String.valueOf(id).equals(info.getRelId())).findFirst()
                .ifPresent(info -> relation.setRelResourceInfo(JSON.toJSONString(info)));
            relations.save(relation);
        }
    }

    private void applyBasic(DigitalEmployeeDTO snapshot, SsResource official) {
        official.setResourceName(snapshot.getResourceName());
        official.setResourceDesc(snapshot.getResourceDesc());
        official.setAvatar(snapshot.getAvatar());
        official.setSample(snapshot.getSample());
        official.setTags(snapshot.getTags());
        official.setCatalogId(snapshot.getCatalogId());
    }

    private void setSnapshot(DigitalEmployeePublication publication, DigitalEmployeeDTO snapshot) {
        if (publication.getOfficialId() == null) snapshot.setResourceName(EmployeePublicationNames.enterpriseName(snapshot.getResourceName(), publication.getEmployeeName()));
        List<Dependency> captured = new java.util.ArrayList<>(dependencies.capture(snapshot, publication.getAuthorId(), publication.getTenantId(), publication.getRequestId()));
        if (StringUtils.isBlank(snapshot.getResourceName()) || snapshot.getResourceName().length() > 300) {
            captured.add(EmployeePublicationResources.blocker("员工名称", "员工名称必填且不能超过 300 个字符"));
        }
        publication.setEmployeeName(StringUtils.left(StringUtils.defaultString(snapshot.getResourceName()), 512));
        JSONObject saved = (JSONObject) JSON.toJSON(snapshot);
        if (StringUtils.isNotBlank(publication.getSnapshotJson())) {
            JSONObject metadata = JSON.parseObject(publication.getSnapshotJson()).getJSONObject(UPDATE_TARGET);
            if (metadata != null) saved.put(UPDATE_TARGET, metadata);
        }
        publication.setSnapshotJson(saved.toJSONString());
        publication.setDependenciesJson(JSON.toJSONString(captured));
        publication.setUpdatedAt(new Date());
    }

    private void validateCandidate(DigitalEmployeePublication publication) {
        SsResource basis = basis(publication);
        requireEmployee(basis);
        if (!Objects.equals(basis.getResourceStatus(), 2)) throw new BaseException("来源员工已下架或注销");
        DigitalEmployeeDTO snapshot = sanitize(JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class), basis);
        if (publication.getOfficialId() == null) {
            snapshot.setResourceName(EmployeePublicationNames.enterpriseName(snapshot.getResourceName(), publication.getEmployeeName()));
            publication.setEmployeeName(snapshot.getResourceName());
            publication.setSnapshotJson(JSON.toJSONString(snapshot));
        }
        if (StringUtils.isBlank(snapshot.getResourceName()) || snapshot.getResourceName().length() > 300) throw new BaseException("员工名称必填且不能超过 300 个字符");
        List<Dependency> captured = dependencyList(publication);
        dependencies.validate(captured, publication.getAuthorId(), publication.getTenantId());
        publication.setDependenciesJson(JSON.toJSONString(captured));
    }

    static DigitalEmployeeDTO sanitize(DigitalEmployeeDTO input, SsResource basis) {
        if (input == null) throw new BaseException("请提供员工配置");
        if (StringUtils.endsWithIgnoreCase(basis.getResourceCode(), "_main") || "personal_default".equals(basis.getOwnerType())) throw new BaseException("超级助手不允许发布");
        if (!DigitalEmployType.isValid(input.getAgentType()) || "017".equals(input.getAgentType())) throw new BaseException("当前仅支持普通数字员工发布，不支持员工组");
        if ("FROM_THIRD".equals(input.getCreateType()) || (StringUtils.isNotBlank(input.getAgentDevType()) && !"byai".equals(input.getAgentDevType()))) throw new BaseException("第三方接入员工请先完成企业接入配置，当前不支持个人发布");
        JSONObject raw = (JSONObject) JSON.toJSON(input);
        JSONObject safe = new JSONObject();
        // Explicit transferable fields. Personal channels, memory, credentials, URLs and runtime mirrors are excluded.
        for (String key : List.of("resourceName", "resourceDesc", "avatar", "sample", "tags", "catalogId", "agentType",
            "prologue", "ability", "constraints", "faqs", "roleAttributes", "processingFlow", "personalityDimensions", "wordPreferences",
            "sentenceAndTone", "terminal", "coreCompetencies", "corePersonaDefinition", "advancedSettings", "ttsModelId", "relIds", "relSkills",
            "relTools", "imageModelId", "relPrompt", "relResourceInfoList")) safe.put(key, raw.get(key));
        DigitalEmployeeDTO result = safe.toJavaObject(DigitalEmployeeDTO.class);
        result.setResourceId(basis.getResourceId());
        result.setResourceBizType("DIG_EMPLOYEE");
        result.setOwnerType(basis.getOwnerType());
        result.setAgentDevType("byai");
        result.setCreateType("FROM_MANUALLY");
        result.setIntegrationType("NONE");
        result.setHomeType("default");
        result.setMachineChannel("[]");
        result.setOpenSuperHelper("N");
        result.setSkills("[]");
        if (StringUtils.isNotBlank(result.getPrologue())) {
            JSONObject prologue = JSON.parseObject(result.getPrologue());
            Object role = prologue.get("role");
            if (role instanceof String text && text.trim().startsWith("{")) {
                JSONObject roleObject = JSON.parseObject(text);
                roleObject.remove("bundledSkills");
                prologue.put("role", roleObject.toJSONString());
            } else if (role instanceof JSONObject roleObject) {
                roleObject.remove("bundledSkills");
            }
            result.setPrologue(prologue.toJSONString());
        }
        result.setMemoryConfigList(List.of());
        if (result.getRelIds() == null) result.setRelIds(List.of());
        if (result.getRelTools() == null) result.setRelTools(List.of());
        if (result.getRelResourceInfoList() == null) result.setRelResourceInfoList(List.of());
        return result;
    }

    private Detail view(DigitalEmployeePublication publication) {
        DigitalEmployeeDetailsDTO employee = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDetailsDTO.class);
        List<Dependency> deps = dependencyList(publication);
        employee.setRelResourceList(deps.stream().map(Dependency::getResource).filter(Objects::nonNull).map(resource -> {
            SsResourceDTO dto = new SsResourceDTO(); BeanUtils.copyProperties(resource, dto); return dto;
        }).toList());
        boolean active = List.of("DRAFT", "PENDING", "FAILED").contains(publication.getStatus());
        boolean editable = "DRAFT".equals(publication.getStatus()) || canReview(publication) && "PENDING".equals(publication.getStatus());
        publication.setRequiresAdminVipReview(requiresAdminVipReview(publication));
        boolean canRevise = false;
        if (List.of("REJECTED", "WITHDRAWN").contains(publication.getStatus())) {
            DigitalEmployeePublication current = publications.current(publication.getSourceId(), publication.getTenantId());
            canRevise = current != null && Objects.equals(current.getRequestId(), publication.getRequestId());
        }
        ReviewResult previousReview = null;
        if (List.of("DRAFT", "PENDING").contains(publication.getStatus()) && publication.getCreatedAt() != null) {
            DigitalEmployeePublication previous = publications.previousRejection(publication.getSourceId(), publication.getTenantId(),
                publication.getCreatedAt(), publication.getRequestId());
            if (previous != null) previousReview = new ReviewResult(String.valueOf(previous.getRequestId()), previous.getReviewerName(),
                previous.getReviewedAt(), previous.getComment());
        }
        return new Detail(publication, employee, deps.stream().map(d -> {
            EmployeePublicationResources.Availability availability = EmployeePublicationResources.describe(d);
            return new DependencyView(d.getResource() == null ? StringUtils.defaultIfBlank(d.getToolCode(), d.getTargetId() == null ? "" : String.valueOf(d.getTargetId())) : String.valueOf(d.getResource().getResourceId()),
                d.getResource() == null ? StringUtils.defaultIfBlank(d.getLabel(), "资源 " + d.getTargetId()) : d.getResource().getResourceName(), d.getAction(), d.getError(), d.getWarning(),
                availability.resourceType(), availability.scope(), availability.reason(), availability.impact());
        }).toList(),
            editable, "DRAFT".equals(publication.getStatus()), canReview(publication), active, canRevise, previousReview,
            updateTarget(publication));
    }

    private DigitalEmployeeDetailsDTO readConfiguration(Long resourceId) {
        EmployeeIdDTO id = new EmployeeIdDTO(); id.setResourceId(resourceId);
        DigitalEmployeeDetailsDTO details = employees.findDetailsById(id);
        if (details == null) throw new BaseException("数字员工配置不存在");
        // 查询对象不被候选配置修改；关联资源中的非技能配置仍参与发布及对照。
        DigitalEmployeeDetailsDTO copy = JSON.parseObject(JSON.toJSONString(details), DigitalEmployeeDetailsDTO.class);
        if (copy.getRelResourceList() != null) copy.setRelResourceInfoList(copy.getRelResourceList().stream()
            .filter(r -> StringUtils.isNotBlank(r.getRelResourceInfo()) && !"SKILL".equals(r.getResourceBizType()))
            .map(r -> JSON.parseObject(r.getRelResourceInfo(), com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo.class)).toList());
        return copy;
    }

    private void requireUpdateTarget(SsResource target, Long sourceId, Long tenant) {
        if (!DigitalEmployeeGovernanceService.isOfficialCopy(target)
            || !Objects.equals(target.getPublicationSourceId(), sourceId)
            || !Objects.equals(target.getComAcctId(), tenant)) throw new BaseException("官方副本已变化，请重新发起更新");
        if (!Objects.equals(target.getResourceStatus(), 2)) throw new BaseException("官方副本已下架或注销，请先处理其状态");
    }

    private String configurationFingerprint(SsResource target) {
        JSONObject data = (JSONObject) JSON.toJSON(sanitize(readConfiguration(target.getResourceId()), target));
        data.put("resourceName", target.getResourceName());
        data.put("resourceDesc", target.getResourceDesc());
        data.put("avatar", target.getAvatar());
        data.put("sample", target.getSample());
        data.put("tags", target.getTags());
        data.put("catalogId", target.getCatalogId());
        // 关联查询的返回顺序不代表配置变化，避免相同资源因数据库顺序不同而误报。
        for (String field : List.of("relIds", "relSkills", "relTools", "relResourceInfoList")) {
            Object value = data.get(field);
            if (value instanceof java.util.Collection<?> items) data.put(field, items.stream()
                .sorted(java.util.Comparator.comparing(item -> JSON.toJSONString(item,
                    com.alibaba.fastjson.serializer.SerializerFeature.MapSortField))).toList());
        }
        // 排序字段，防止 JSONObject 的键迭代顺序造成误报。
        return org.apache.commons.codec.digest.DigestUtils.sha256Hex(
            JSON.toJSONString(data, com.alibaba.fastjson.serializer.SerializerFeature.MapSortField));
    }

    private boolean isFromPersonal(DigitalEmployeePublication publication) {
        JSONObject metadata = JSON.parseObject(publication.getSnapshotJson()).getJSONObject(UPDATE_TARGET);
        return metadata != null && metadata.getBooleanValue("fromPersonal");
    }

    private void captureUpdateTarget(DigitalEmployeePublication publication, SsResource target, boolean fromPersonal) {
        JSONObject snapshot = JSON.parseObject(publication.getSnapshotJson());
        JSONObject metadata = new JSONObject();
        metadata.put("fingerprint", configurationFingerprint(target));
        metadata.put("fromPersonal", fromPersonal);
        snapshot.put(UPDATE_TARGET, metadata);
        publication.setSnapshotJson(snapshot.toJSONString());
    }

    private UpdateTarget updateTarget(DigitalEmployeePublication publication) {
        if (publication.getOfficialId() == null || !List.of("DRAFT", "PENDING", "FAILED", "APPLYING").contains(publication.getStatus())) return null;
        SsResource target = basis(publication);
        JSONObject metadata = JSON.parseObject(publication.getSnapshotJson()).getJSONObject(UPDATE_TARGET);
        boolean changed = metadata == null || !Objects.equals(metadata.getString("fingerprint"), configurationFingerprint(target));
        return new UpdateTarget(String.valueOf(target.getResourceId()), target.getResourceName(), isFromPersonal(publication), changed);
    }

    private void requireUnchangedUpdateTarget(DigitalEmployeePublication publication) {
        if (publication.getOfficialId() == null) return;
        SsResource target = publications.lockResource(publication.getOfficialId(), publication.getTenantId());
        requireUpdateTarget(target, publication.getSourceId(), publication.getTenantId());
        requireUnchangedUpdateTarget(publication, target);
    }

    private void requireUnchangedUpdateTarget(DigitalEmployeePublication publication, SsResource target) {
        JSONObject metadata = JSON.parseObject(publication.getSnapshotJson()).getJSONObject(UPDATE_TARGET);
        if (metadata == null) throw new BaseException("当前更新申请尚未对照官方配置，请重新对照并确认覆盖范围");
        if (!Objects.equals(metadata.getString("fingerprint"), configurationFingerprint(target))) {
            throw new BaseException("官方员工配置已变化，请重新对照官方配置并确认覆盖范围后再提交或审核");
        }
    }

    private boolean canReview(DigitalEmployeePublication publication) {
        if (!DigitalEmployeeGovernanceService.isAdministrator()
            || !Objects.equals(publication.getTenantId(), CurrentUserHolder.getEnterpriseId())) return false;
        boolean reviewable = List.of("PENDING", "FAILED").contains(publication.getStatus())
            || "APPLYING".equals(publication.getStatus()) && publication.getUpdatedAt() != null
                && publication.getUpdatedAt().before(new Date(System.currentTimeMillis() - 10 * 60_000L));
        if (!reviewable) return false;
        SsResource resource = resources.selectById(publication.getOfficialId() == null ? publication.getSourceId() : publication.getOfficialId());
        return DigitalEmployeeGovernanceService.isEmployee(resource)
            && Objects.equals(resource.getComAcctId(), publication.getTenantId())
            && Objects.equals(resource.getCreateBy(), publication.getAuthorId())
            && (CurrentUserHolder.isAdminVip() || !requiresAdminVipReview(publication));
    }

    private boolean requiresAdminVipReview(DigitalEmployeePublication publication) {
        // 员工创建者不再触发特殊审核；保留原判断，关联个人技能仍按自身规则审核。
        // if (governance.isAdminVipCreator(publication.getAuthorId())) return true;
        return dependencyList(publication).stream().filter(d -> "COPY_SKILL".equals(d.getAction()))
            .map(Dependency::getResource).filter(Objects::nonNull)
            .map(SsResource::getCreateBy)
            // 原先作者已在上方判断，现在技能作者与员工作者相同时也需检查技能规则。
            // .filter(creatorId -> !Objects.equals(creatorId, publication.getAuthorId()))
            .distinct().anyMatch(governance::isAdminVipCreator);
    }

    private List<Dependency> dependencyList(DigitalEmployeePublication publication) {
        List<Dependency> captured = JSON.parseArray(publication.getDependenciesJson(), Dependency.class);
        captured.stream().filter(d -> "*".equals(d.getToolCode())).forEach(d -> {
            d.setAction("BUILTIN_TOOL");
            d.setWarning(null);
        });
        // 兼容升级前保存的资源阻塞记录；技能快照在执行前仍需经过当前 A 校验。
        captured.stream().filter(d -> d.getResource() != null || d.getTargetId() != null).forEach(d -> {
            if (!List.of("COPY_SKILL", "UNAVAILABLE_RESOURCE", "OMIT_RESOURCE").contains(d.getAction())) {
                d.setAction(EmployeePublicationResources.isTool(d.getResource()) ? "REFERENCE_TOOL" : "REFERENCE_RESOURCE");
            }
            if (d.getError() != null) {
                d.setWarning("资源将按当前发布规则重新检查，不可携带的资源不会带入企业员工");
                d.setError(null);
            }
        });
        return captured;
    }
    private Long requireEnabled() {
        if (CurrentUserHolder.getCurrentUserId() == null || CurrentUserHolder.getEnterpriseId() == null) throw new BaseException("请先登录当前企业");
        return CurrentUserHolder.getEnterpriseId();
    }
    private void requireEmployee(SsResource resource) {
        if (!DigitalEmployeeGovernanceService.isEmployee(resource)) throw new BaseException("数字员工不存在");
    }
    private SsResource basis(DigitalEmployeePublication publication) {
        SsResource resource = resources.selectById(publication.getOfficialId() == null ? publication.getSourceId() : publication.getOfficialId());
        requireEmployee(resource);
        if (!Objects.equals(publication.getTenantId(), resource.getComAcctId()) || !Objects.equals(publication.getAuthorId(), resource.getCreateBy())) throw new BaseException("员工归属已变更");
        return resource;
    }
    private void requireView(DigitalEmployeePublication publication) {
        if (publication == null || !Objects.equals(publication.getTenantId(), CurrentUserHolder.getEnterpriseId())
            || (!DigitalEmployeeGovernanceService.isAdministrator() && !Objects.equals(publication.getAuthorId(), CurrentUserHolder.getCurrentUserId()))) throw new BaseException("发布申请不存在或无权访问");
        basis(publication);
    }
    private DigitalEmployeePublication locked(EmployeePublicationRequest request) {
        DigitalEmployeePublication publication = publications.lock(request.getRequestId(), CurrentUserHolder.getEnterpriseId());
        requireView(publication);
        if (!Objects.equals(publication.getRevision(), request.getRevision())) throw new BaseException("申请已被修改，请刷新后再操作");
        return publication;
    }
    private void requireEditable(DigitalEmployeePublication publication) {
        requireState(publication, "DRAFT", "PENDING");
        if ("PENDING".equals(publication.getStatus()) && !canReview(publication)) throw new BaseException("审核期间不可编辑，请先撤回申请");
    }
    private void requireReviewer(DigitalEmployeePublication publication) {
        if (!DigitalEmployeeGovernanceService.isAdministrator()) throw new BaseException("仅 adminvip 和平台管理员可以审核");
        basis(publication);
        if (!CurrentUserHolder.isAdminVip() && requiresAdminVipReview(publication)) {
            // throw new BaseException("申请包含 adminvip 创建的员工或个人技能，仅允许 adminvip 审核");
            throw new BaseException(com.iwhalecloud.byai.common.i18n.I18nUtil.get("employee.publication.adminvip.skill.review"));
        }
    }
    private void requireState(DigitalEmployeePublication publication, String... states) {
        if (!List.of(states).contains(publication.getStatus())) throw new BaseException("当前申请状态不允许此操作");
    }
    private void reviewStamp(DigitalEmployeePublication publication, String comment) {
        publication.setReviewerId(CurrentUserHolder.getCurrentUserId());
        publication.setReviewerName(CurrentUserHolder.getCurrentUserName());
        publication.setReviewedAt(new Date());
        publication.setComment(StringUtils.left(comment, 2000));
    }
    private void advance(DigitalEmployeePublication publication) {
        publication.setRevision(publication.getRevision() + 1);
        publication.setUpdatedAt(new Date());
        // Null fields must also be persisted (e.g. clearing the previous sync error on successful retry).
        publications.update(null, new com.baomidou.mybatisplus.core.conditions.update.UpdateWrapper<DigitalEmployeePublication>()
            .eq("request_id", publication.getRequestId()).set("snapshot_json", publication.getSnapshotJson())
            .set("dependencies_json", publication.getDependenciesJson()).set("employee_name", publication.getEmployeeName())
            .set("official_id", publication.getOfficialId()).set("status", publication.getStatus()).set("revision", publication.getRevision())
            .set("updated_at", publication.getUpdatedAt()).set("comment", publication.getComment()).set("publish_error", publication.getPublishError())
            .set("reviewer_id", publication.getReviewerId()).set("reviewer_name", publication.getReviewerName()).set("reviewed_at", publication.getReviewedAt()));
    }
}
