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
        return Map.of("enabled", governance.publicationEnabled(), "administrator", DigitalEmployeeGovernanceService.isAdministrator(),
            "canCreateEnterprise", DigitalEmployeeGovernanceService.isAdministrator());
    }

    public record DependencyView(String resourceId, String name, String action, String error) { }
    public record ReviewResult(String requestId, String reviewerName, Date reviewedAt, String comment) { }
    public record Detail(DigitalEmployeePublication publication, DigitalEmployeeDetailsDTO employee,
        List<DependencyView> dependencies, boolean canEdit, boolean canSubmit, boolean canReview, boolean canWithdraw,
        boolean canRevise, ReviewResult previousReview) { }
    public record Page(List<DigitalEmployeePublication> list, long total) { }

    public long pendingCount() {
        if (!governance.publicationEnabled() || !DigitalEmployeeGovernanceService.isAdministrator()
            || CurrentUserHolder.getEnterpriseId() == null) return 0;
        return publications.selectCount(new LambdaQueryWrapper<DigitalEmployeePublication>()
            .eq(DigitalEmployeePublication::getTenantId, CurrentUserHolder.getEnterpriseId())
            .in(DigitalEmployeePublication::getStatus, "PENDING", "FAILED"));
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
        rows.forEach(publication -> publication.setCanReview(canReview(publication)));
        return new Page(rows, total);
    }

    public Detail detail(Long id) {
        requireEnabled();
        DigitalEmployeePublication publication = publications.selectById(id);
        requireView(publication);
        return view(publication);
    }

    /** 只读打开当前申请；查看审核结果不得隐式创建草稿。 */
    public Detail current(Long resourceId) {
        Long tenant = requireEnabled();
        SsResource requested = requireEntryResource(resourceId, tenant, true);
        Long sourceId = DigitalEmployeeGovernanceService.isOfficialCopy(requested) ? requested.getPublicationSourceId() : resourceId;
        DigitalEmployeePublication current = publications.current(sourceId, tenant);
        if (current == null) return null;
        requireView(current);
        return view(current);
    }

    private SsResource requireEntryResource(Long resourceId, Long tenant, boolean readOnly) {
        SsResource requested = resources.selectById(resourceId);
        if (requested == null || !Objects.equals(tenant, requested.getComAcctId())) throw new BaseException("数字员工不存在");
        requireEmployee(requested);
        governance.requireNotProtected(requested);
        boolean official = DigitalEmployeeGovernanceService.isOfficialCopy(requested);
        if (official ? !governance.canMaintainOfficial(requested)
            : !Objects.equals(requested.getCreateBy(), CurrentUserHolder.getCurrentUserId())
                && !(readOnly && DigitalEmployeeGovernanceService.isAdministrator())) {
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
        Long tenant = requireEnabled();
        return transaction.execute(status -> {
            SsResource requested = requireEntryResource(resourceId, tenant, false);
            boolean official = DigitalEmployeeGovernanceService.isOfficialCopy(requested);
            Long sourceId = official ? requested.getPublicationSourceId() : resourceId;
            if (!Objects.equals(requested.getResourceStatus(), 2)) throw new BaseException("仅在用数字员工支持发起发布或更新");
            // A stable source row serializes initial publication and official-update requests.
            publications.lockResource(sourceId, tenant);
            requested = publications.lockResource(resourceId, tenant);
            DigitalEmployeePublication active = publications.active(sourceId, tenant);
            if (active != null) { requireView(active); return view(active); }
            DigitalEmployeePublication latest = publications.current(sourceId, tenant);
            if (latest != null && (!official || !"PUBLISHED".equals(latest.getStatus()))) {
                requireView(latest);
                return view(latest);
            }
            SsResource existing = publications.official(sourceId, tenant);
            if (!official && existing != null) throw new BaseException("该员工已有官方副本，请从官方推荐中编辑副本");
            EmployeeIdDTO employeeId = new EmployeeIdDTO();
            employeeId.setResourceId(resourceId);
            DigitalEmployeeDetailsDTO details = employees.findDetailsById(employeeId);
            if (details.getRelResourceList() != null) {
                details.setRelResourceInfoList(details.getRelResourceList().stream()
                    .filter(r -> StringUtils.isNotBlank(r.getRelResourceInfo()) && !"SKILL".equals(r.getResourceBizType()))
                    .map(r -> JSON.parseObject(r.getRelResourceInfo(), com.iwhalecloud.byai.manager.dto.digitemploy.RelResourceInfo.class)).toList());
            }
            DigitalEmployeeDTO snapshot = sanitize(details, requested);
            DigitalEmployeePublication publication = new DigitalEmployeePublication();
            publication.setRequestId(sequence.nextVal());
            publication.setTenantId(tenant);
            publication.setSourceId(sourceId);
            publication.setAuthorId(requested.getCreateBy());
            // Attribution follows the original resource creator, never the reviewing administrator.
            publication.setAuthorName(StringUtils.defaultIfBlank(publications.creatorName(requested.getCreateBy()), String.valueOf(requested.getCreateBy())));
            publication.setOfficialId(official ? resourceId : null);
            publication.setStatus("DRAFT");
            publication.setRevision(1L);
            publication.setCreatedAt(new Date());
            setSnapshot(publication, snapshot);
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
            next.setOfficialId(official == null ? null : official.getResourceId());
            next.setStatus("DRAFT"); next.setRevision(1L); next.setCreatedAt(new Date());
            setSnapshot(next, sanitize(JSON.parseObject(previous.getSnapshotJson(), DigitalEmployeeDTO.class), basis(next)));
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

    public Detail submit(EmployeePublicationRequest request) {
        requireEnabled();
        Detail result = transaction.execute(status -> {
            DigitalEmployeePublication publication = locked(request);
            requireState(publication, "DRAFT");
            requireEditable(publication);
            validateCandidate(publication);
            publication.setStatus("PENDING");
            publication.setComment(null);
            advance(publication);
            return view(publication);
        });
        if (DigitalEmployeeGovernanceService.isAdministrator()) {
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
                publications.lockResource(publication.getSourceId(), tenant);
                validateCandidate(publication);
                SsResource official = publications.official(publication.getSourceId(), tenant);
                boolean fresh = official == null;
                if (!fresh) official = publications.lockResource(official.getResourceId(), tenant);
                if (!fresh && !Objects.equals(official.getResourceStatus(), 2)) throw new BaseException("官方副本已下架或注销，请先处理其状态");
                DigitalEmployeeDTO snapshot = JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class);
                if (fresh) {
                    official = new SsResource();
                    official.setResourceId(sequence.nextVal());
                    official.setResourceCode("official-employee-" + official.getResourceId());
                    official.setCreateBy(publication.getAuthorId());
                    official.setCreateTime(new Date());
                    official.setComAcctId(tenant);
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
                Map<Long, Long> mapped = dependencies.materialize(dependencyList(publication), tenant);
                snapshot.setResourceId(official.getResourceId());
                snapshot.setOwnerType("enterprise");
                snapshot.setResourceCode(official.getResourceCode());
                snapshot.setRelIds(snapshot.getRelIds().stream().map(mapped::get).toList());
                snapshot.setRelSkills(List.of()); // Canonical skill metadata is rebuilt from copied relations.
                snapshot.setSkills("[]");
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
        List<Dependency> captured = dependencies.capture(snapshot, publication.getAuthorId(), publication.getTenantId(), publication.getRequestId());
        publication.setEmployeeName(snapshot.getResourceName());
        publication.setSnapshotJson(JSON.toJSONString(snapshot));
        publication.setDependenciesJson(JSON.toJSONString(captured));
        publication.setUpdatedAt(new Date());
    }

    private void validateCandidate(DigitalEmployeePublication publication) {
        SsResource basis = basis(publication);
        requireEmployee(basis);
        if (!Objects.equals(basis.getResourceStatus(), 2)) throw new BaseException("来源员工已下架或注销");
        sanitize(JSON.parseObject(publication.getSnapshotJson(), DigitalEmployeeDTO.class), basis);
        dependencies.validate(dependencyList(publication), publication.getAuthorId(), publication.getTenantId());
    }

    static DigitalEmployeeDTO sanitize(DigitalEmployeeDTO input, SsResource basis) {
        if (input == null) throw new BaseException("请提供员工配置");
        if (StringUtils.endsWithIgnoreCase(basis.getResourceCode(), "_main") || "personal_default".equals(basis.getOwnerType())) throw new BaseException("超级助手不允许发布");
        if (!DigitalEmployType.isValid(input.getAgentType()) || "017".equals(input.getAgentType())) throw new BaseException("当前仅支持普通数字员工发布，不支持员工组");
        if ("FROM_THIRD".equals(input.getCreateType()) || (StringUtils.isNotBlank(input.getAgentDevType()) && !"byai".equals(input.getAgentDevType()))) throw new BaseException("第三方接入员工请先完成企业接入配置，当前不支持个人发布");
        if (StringUtils.isBlank(input.getResourceName()) || input.getResourceName().length() > 300) throw new BaseException("员工名称必填且不能超过 300 个字符");
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
        boolean administrator = DigitalEmployeeGovernanceService.isAdministrator();
        boolean editable = "DRAFT".equals(publication.getStatus()) || administrator && "PENDING".equals(publication.getStatus());
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
        return new Detail(publication, employee, deps.stream().map(d -> new DependencyView(d.getResource() == null ? "" : String.valueOf(d.getResource().getResourceId()),
            d.getResource() == null ? "不存在的资源" : d.getResource().getResourceName(), d.getAction(), d.getError())).toList(),
            editable, "DRAFT".equals(publication.getStatus()), canReview(publication), active, canRevise, previousReview);
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
            && Objects.equals(resource.getCreateBy(), publication.getAuthorId()) && !governance.isProtected(resource);
    }

    private List<Dependency> dependencyList(DigitalEmployeePublication publication) {
        return JSON.parseArray(publication.getDependenciesJson(), Dependency.class);
    }
    private Long requireEnabled() {
        if (!governance.publicationEnabled()) throw new BaseException("数字员工发布仅在开源版本可用");
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
        governance.requireNotProtected(resource);
        return resource;
    }
    private void requireView(DigitalEmployeePublication publication) {
        if (publication == null || !Objects.equals(publication.getTenantId(), CurrentUserHolder.getEnterpriseId())
            || (!DigitalEmployeeGovernanceService.isAdministrator() && !Objects.equals(publication.getAuthorId(), CurrentUserHolder.getCurrentUserId()))) throw new BaseException("发布申请不存在或无权访问");
        governance.requireNotProtected(basis(publication));
    }
    private DigitalEmployeePublication locked(EmployeePublicationRequest request) {
        DigitalEmployeePublication publication = publications.lock(request.getRequestId(), CurrentUserHolder.getEnterpriseId());
        requireView(publication);
        if (!Objects.equals(publication.getRevision(), request.getRevision())) throw new BaseException("申请已被修改，请刷新后再操作");
        return publication;
    }
    private void requireEditable(DigitalEmployeePublication publication) {
        requireState(publication, "DRAFT", "PENDING");
        if ("PENDING".equals(publication.getStatus()) && !DigitalEmployeeGovernanceService.isAdministrator()) throw new BaseException("审核期间不可编辑，请先撤回申请");
    }
    private void requireReviewer(DigitalEmployeePublication publication) {
        if (!DigitalEmployeeGovernanceService.isAdministrator()) throw new BaseException("仅 adminvip 和平台管理员可以审核");
        governance.requireNotProtected(basis(publication));
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
