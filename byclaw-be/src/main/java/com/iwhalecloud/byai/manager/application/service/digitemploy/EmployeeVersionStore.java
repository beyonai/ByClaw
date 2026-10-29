package com.iwhalecloud.byai.manager.application.service.digitemploy;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.dto.digitemploy.DigitalEmployeeDTO;
import com.iwhalecloud.byai.manager.dto.digitemploy.EmployeeIdDTO;
import com.iwhalecloud.byai.manager.entity.resource.*;
import com.iwhalecloud.byai.manager.mapper.resource.*;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.Date;
import java.util.List;
import java.util.Objects;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.stereotype.Component;

/** 必须在调用者的事务和 resource 业务锁内写入；CAS 防止过期编辑覆盖。 */
@Component
public class EmployeeVersionStore {
    @Autowired private SsResourceMapper resources;
    @Autowired private SsResourceVersionMapper versions;
    @Autowired private EmployeeVersionRelationMapper relations;
    @Autowired private EmployeeVersionActivationMapper activations;
    @Autowired private SequenceService sequence;
    @Autowired @Lazy private DigitalEmployeeApplicationService employees;

    public static long revision(SsResource resource) { return resource.getConfigRevision() == null ? 0 : resource.getConfigRevision(); }
    public void checkRevision(SsResource resource, Long expected) {
        if (expected != null && expected != revision(resource)) throw new BaseException("配置已被他人修改，请刷新后对比版本再保存");
    }
    public DigitalEmployeeDTO current(Long resourceId) {
        EmployeeIdDTO id = new EmployeeIdDTO(); id.setResourceId(resourceId);
        return employees.findDetailsById(id);
    }
    public SsResourceVersion requireVersion(SsResource resource, Long versionId) {
        SsResourceVersion version = versionId == null ? null : versions.selectById(versionId);
        if (version == null || !Objects.equals(resource.getResourceId(), version.getResourceId())
            || !Objects.equals(resource.getComAcctId(), version.getComAcctId()) || version.getVersionSeq() == null)
            throw new BaseException("该数字员工版本不存在或不可访问");
        EmployeeVersionSnapshot.decode(version.getExtInfo());
        return version;
    }
    public List<SsResourceVersion> history(SsResource resource, int page, int size) {
        int limit = Math.min(100, Math.max(1, size));
        return versions.selectList(new LambdaQueryWrapper<SsResourceVersion>()
            .eq(SsResourceVersion::getComAcctId, resource.getComAcctId())
            .eq(SsResourceVersion::getResourceId, resource.getResourceId())
            .isNotNull(SsResourceVersion::getVersionSeq).orderByDesc(SsResourceVersion::getVersionSeq)
            .last("limit " + limit + " offset " + Math.max(0, page - 1) * (long) limit));
    }
    public SsResourceVersion savedRequest(SsResource resource, String requestId) {
        if (requestId == null || requestId.isBlank()) return null;
        return versions.selectOne(new LambdaQueryWrapper<SsResourceVersion>()
            .eq(SsResourceVersion::getComAcctId, resource.getComAcctId())
            .eq(SsResourceVersion::getResourceId, resource.getResourceId())
            .eq(SsResourceVersion::getSaveRequestId, requestId));
    }
    /** 上线前只知道当前配置；第一次维护时建立基线，不伪造早期历史。 */
    public void baseline(SsResource resource) {
        if (resource.getConfigVersionSeq() != null && resource.getConfigVersionSeq() > 0) return;
        SsResourceVersion baseline = insert(resource, current(resource.getResourceId()), 1, null, "BASELINE", null, null, null);
        var update = update(resource).set(SsResource::getConfigVersionSeq, 1L)
            .set(SsResource::getResourceDVerid, baseline.getResourceVersionId())
            .set(SsResource::getResourceRVerid, baseline.getResourceVersionId());
        changed(resources.update(null, update));
        resource.setConfigVersionSeq(1L); resource.setResourceDVerid(baseline.getResourceVersionId());
        resource.setResourceRVerid(baseline.getResourceVersionId());
        markActive(resource, baseline.getResourceVersionId());
    }
    public SsResourceVersion append(SsResource resource, DigitalEmployeeDTO input, Long baseVersion,
        String source, String note, String requestId, Long sourceVersion) {
        long next = (resource.getConfigVersionSeq() == null ? 0 : resource.getConfigVersionSeq()) + 1;
        if (baseVersion != null) requireVersion(resource, baseVersion);
        SsResourceVersion version = insert(resource, input, next, baseVersion, source, note, requestId, sourceVersion);
        long nextRevision = revision(resource) + 1;
        changed(resources.update(null, update(resource).set(SsResource::getConfigRevision, nextRevision)
            .set(SsResource::getConfigVersionSeq, next).set(SsResource::getResourceDVerid, version.getResourceVersionId())));
        resource.setConfigRevision(nextRevision); resource.setConfigVersionSeq(next);
        resource.setResourceDVerid(version.getResourceVersionId());
        return version;
    }
    private SsResourceVersion insert(SsResource resource, DigitalEmployeeDTO input, long seq, Long base,
        String source, String note, String requestId, Long sourceVersion) {
        String snapshot = EmployeeVersionSnapshot.encode(input);
        SsResourceVersion version = new SsResourceVersion();
        version.setResourceVersionId(sequence.nextVal()); version.setResourceId(resource.getResourceId());
        version.setComAcctId(resource.getComAcctId()); version.setResourceBizType("DIG_EMPLOYEE");
        version.setResourceName(input.getResourceName()); version.setResourceDesc(input.getResourceDesc());
        version.setAvatar(input.getAvatar()); version.setVersionSeq(seq); version.setVersionNo("V" + seq);
        version.setBaseVersionId(base); version.setSourceVersionId(sourceVersion);
        version.setSnapshotSchemaVersion(EmployeeVersionSnapshot.SCHEMA); version.setExtInfo(snapshot);
        version.setContentHash(EmployeeVersionSnapshot.hash(snapshot)); version.setVersionSource(source);
        version.setChangeNote(note); version.setSaveRequestId(requestId); version.setSavedRevision(revision(resource) + 1); version.setVersionStatus(1);
        version.setCreateBy(CurrentUserHolder.getCurrentUserId()); version.setCreateTime(new Date());
        versions.insert(version);
        indexRelations(resource, version, input);
        return version;
    }
    private void indexRelations(SsResource resource, SsResourceVersion version, DigitalEmployeeDTO input) {
        int order = 0;
        if (input.getRelIds() != null) for (Long id : input.getRelIds().stream().filter(Objects::nonNull).distinct().toList())
            relation(resource, version, "RESOURCE", id, null, order++, null);
        if (input.getRelTools() != null) for (String code : input.getRelTools().stream().filter(Objects::nonNull).distinct().toList())
            relation(resource, version, "TOOL", null, code, order++, null);
        if (input.getRelSkills() != null) for (Object skill : EmployeeVersionSnapshot.configuration(input).getJSONArray("relSkills")) {
            JSONObject config = skill instanceof String ? null : (JSONObject) skill;
            relation(resource, version, "SKILL", config == null ? null : config.getLong("resourceId"),
                config == null ? (String) skill : config.getString("skillCode"), order++, JSON.toJSONString(skill));
        }
        if (input.getEmployeeGroupMembers() != null) for (var member : input.getEmployeeGroupMembers())
            relation(resource, version, "EMPLOYEE_MEMBER", member.getResourceId(), null, order++, JSON.toJSONString(member));
        JSONObject prologue = JSON.parseObject(input.getPrologue() == null ? "{}" : input.getPrologue());
        JSONObject model = prologue.getJSONObject("modelInfo");
        if (model != null && model.getString("modelId") != null)
            relation(resource, version, "MODEL", null, model.getString("modelId"), order++, null);
        if (input.getImageModelId() != null) relation(resource, version, "IMAGE_MODEL", null, input.getImageModelId(), order++, null);
        if (input.getTtsModelId() != null) relation(resource, version, "TTS_MODEL", input.getTtsModelId(), null, order, null);
    }
    private void relation(SsResource resource, SsResourceVersion version, String type, Long target, String code, int order, String config) {
        EmployeeVersionRelation relation = new EmployeeVersionRelation();
        relation.setRelationId(sequence.nextVal()); relation.setTenantId(resource.getComAcctId());
        relation.setResourceId(resource.getResourceId()); relation.setVersionId(version.getResourceVersionId());
        relation.setRelationType(type); relation.setTargetResourceId(target); relation.setTargetCode(code);
        relation.setBindingMode("CURRENT"); relation.setSortOrder(order); relation.setRelationConfig(config);
        relations.insert(relation);
    }
    /** 配置落库后与主/扩展/关系表同事务更新生效指针，运行态同步结果独立记录。 */
    public EmployeeVersionActivation activate(SsResource resource, SsResourceVersion version, String requestId, String reason) {
        var previous = pending(resource);
        if (previous != null) {
            previous.setStatus("SUPERSEDED"); previous.setCompletedAt(new Date()); activations.updateById(previous);
        }
        EmployeeVersionActivation activation = new EmployeeVersionActivation();
        activation.setActivationId(sequence.nextVal()); activation.setTenantId(resource.getComAcctId());
        activation.setResourceId(resource.getResourceId()); activation.setFromVersionId(resource.getResourceRVerid());
        activation.setToVersionId(version.getResourceVersionId()); activation.setExpectedRevision(revision(resource));
        activation.setOperatorId(CurrentUserHolder.getCurrentUserId()); activation.setRequestId(requestId);
        activation.setReason(reason); activation.setStatus("SYNC_PENDING"); activation.setRetryCount(0); activation.setCreatedAt(new Date());
        activations.insert(activation);
        long next = revision(resource) + 1;
        changed(resources.update(null, update(resource).set(SsResource::getConfigRevision, next)
            .set(SsResource::getResourceRVerid, version.getResourceVersionId())
            .set(SsResource::getResourceDVerid, resource.getResourceDVerid())
            .set(SsResource::getPendingActivationId, activation.getActivationId())));
        resource.setConfigRevision(next); resource.setResourceRVerid(version.getResourceVersionId());
        resource.setPendingActivationId(activation.getActivationId());
        markActive(resource, version.getResourceVersionId());
        return activation;
    }
    public void recordCurrent(SsResource resource, DigitalEmployeeDTO input, String source) {
        // 调用者可能持有旧实体（如员工组保存刚生成内部运行快照），重新读取计数。
        SsResource live = resources.selectById(resource.getResourceId());
        DigitalEmployeeDTO snapshot = current(resource.getResourceId());
        if (input != null) {
            snapshot.setRelTools(input.getRelTools()); snapshot.setImageModelId(input.getImageModelId());
            snapshot.setRelPrompt(input.getRelPrompt());
        }
        live.setResourceDVerid(resource.getResourceDVerid());
        live.setResourceRVerid(resource.getConfigVersionSeq() == null || resource.getConfigVersionSeq() == 0
            ? null : resource.getResourceRVerid());
        Long target = EmployeeVersionContext.target();
        SsResourceVersion version = target == null ? append(live, snapshot, live.getConfigVersionSeq() == null
            || live.getConfigVersionSeq() == 0 ? null : resource.getResourceRVerid(), source, null, null, null)
            : requireVersion(live, target);
        activate(live, version, EmployeeVersionContext.requestId(), source);
        resource.setConfigVersionSeq(live.getConfigVersionSeq()); resource.setConfigRevision(live.getConfigRevision());
        resource.setResourceDVerid(live.getResourceDVerid()); resource.setResourceRVerid(live.getResourceRVerid());
        resource.setPendingActivationId(live.getPendingActivationId());
    }
    public void runtimeReady(SsResource resource) {
        var pending = pending(resource);
        if (pending == null) return;
        pending.setStatus("READY"); pending.setErrorMessage(null); pending.setCompletedAt(new Date()); activations.updateById(pending);
        resources.update(null, new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, resource.getResourceId())
            .eq(SsResource::getComAcctId, resource.getComAcctId()).eq(SsResource::getPendingActivationId, pending.getActivationId())
            .set(SsResource::getPendingActivationId, null));
        resource.setPendingActivationId(null);
    }
    public EmployeeVersionActivation activationRequest(SsResource resource, String requestId) {
        if (requestId == null) return null;
        return activations.selectOne(new LambdaQueryWrapper<EmployeeVersionActivation>()
            .eq(EmployeeVersionActivation::getTenantId, resource.getComAcctId())
            .eq(EmployeeVersionActivation::getResourceId, resource.getResourceId())
            .eq(EmployeeVersionActivation::getRequestId, requestId));
    }
    public EmployeeVersionActivation pending(SsResource resource) {
        return resource.getPendingActivationId() == null ? null : activations.selectById(resource.getPendingActivationId());
    }
    private LambdaUpdateWrapper<SsResource> update(SsResource resource) {
        return new LambdaUpdateWrapper<SsResource>().eq(SsResource::getResourceId, resource.getResourceId())
            .eq(SsResource::getComAcctId, resource.getComAcctId()).apply("COALESCE(config_revision, 0) = {0}", revision(resource));
    }
    private void markActive(SsResource resource, Long id) {
        versions.update(null, new LambdaUpdateWrapper<SsResourceVersion>()
            .eq(SsResourceVersion::getResourceId, resource.getResourceId()).eq(SsResourceVersion::getComAcctId, resource.getComAcctId())
            .eq(SsResourceVersion::getVersionStatus, 3).set(SsResourceVersion::getVersionStatus, 1));
        versions.update(null, new LambdaUpdateWrapper<SsResourceVersion>().eq(SsResourceVersion::getResourceVersionId, id)
            .eq(SsResourceVersion::getResourceId, resource.getResourceId()).set(SsResourceVersion::getVersionStatus, 3));
    }
    private static void changed(int rows) { if (rows != 1) throw new BaseException("版本保存冲突，请刷新后重试"); }
}
