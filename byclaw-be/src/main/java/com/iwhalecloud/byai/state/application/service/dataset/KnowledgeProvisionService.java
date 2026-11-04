package com.iwhalecloud.byai.state.application.service.dataset;

import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationAccess;
import com.iwhalecloud.byai.manager.application.service.resource.ResourcePublicationService;
import com.iwhalecloud.byai.manager.dto.resource.DatasetDto;
import com.iwhalecloud.byai.manager.entity.resource.KnowledgeProvisionTask;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.KnowledgeProvisionTaskMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.*;
import lombok.RequiredArgsConstructor;
import org.apache.commons.codec.digest.DigestUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.annotation.Lazy;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.PlatformTransactionManager;
import org.springframework.transaction.TransactionDefinition;
import org.springframework.transaction.support.TransactionTemplate;

/** External I/O never participates in a database transaction or a blind retry. */
@Service @RequiredArgsConstructor
public class KnowledgeProvisionService {
    private final KnowledgeProvisionTaskMapper tasks;
    private final SsResourceMapper resources;
    private final KnowledgeProviderService providers;
    private final ResourcePublicationAccess scopeAccess;
    private final ResourcePublicationService publications;
    private final SequenceService sequence;
    private final PlatformTransactionManager transactionManager;
    @Autowired @Lazy private DatasetApplicationService datasets;

    private TransactionTemplate transaction() {
        TransactionTemplate tx = new TransactionTemplate(transactionManager);
        tx.setPropagationBehavior(TransactionDefinition.PROPAGATION_REQUIRES_NEW);
        return tx;
    }
    public SsResource create(DatasetDto dto) {
        Long tenant = CurrentUserHolder.getEnterpriseId(), user = CurrentUserHolder.getCurrentUserId();
        if (tenant == null || tenant <= 0 || user == null || user <= 0) throw new BaseException("请先选择企业并登录");
        if (!Set.of("personal", "enterprise").contains(StringUtils.defaultString(dto.getOwnerType()))
            || StringUtils.isBlank(dto.getResourceName()) || !"KG_DOC".equals(dto.getResourceBizType())) throw new BaseException("知识库创建参数无效");
        if (dto.getPublishScope() != null) {
            if (!"enterprise".equals(dto.getOwnerType())) throw new BaseException("个人知识库不设置组织范围");
            scopeAccess.normalize(dto.getPublishScope());
        }
        if (StringUtils.isBlank(dto.getIdempotencyKey()) || dto.getIdempotencyKey().length() > 128) throw new BaseException("外部建库必须提供有效幂等键");
        Map<String, Object> fields = new LinkedHashMap<>();
        fields.put("name", dto.getResourceName()); fields.put("description", dto.getResourceDesc()); fields.put("ownerType", dto.getOwnerType());
        fields.put("catalogId", dto.getCatalogId()); fields.put("providerId", dto.getProviderId()); fields.put("publishScope", dto.getPublishScope() == null ? null : scopeAccess.normalize(dto.getPublishScope()));
        String json = JSON.toJSONString(fields), hash = DigestUtils.sha256Hex(json);
        KnowledgeProvisionTask task = find(tenant, user, dto.getIdempotencyKey());
        if (task != null && !hash.equals(task.getRequestHash())) throw new BaseException("幂等键已用于不同的建库请求");
        if (task != null && "SUCCEEDED".equals(task.getStatus())) return ownedResult(task);
        var provider = providers.provider(dto.getProviderId());
        if (task == null) {
            KnowledgeProvisionTask pending = new KnowledgeProvisionTask();
            pending.setTaskId(sequence.nextVal()); pending.setTenantId(tenant); pending.setApplicantId(user);
            pending.setProviderId(dto.getProviderId()); pending.setIdempotencyKey(dto.getIdempotencyKey());
            pending.setRequestHash(hash); pending.setRequestJson(json); pending.setStatus("PENDING");
            pending.setCreatedAt(new Date()); pending.setUpdatedAt(new Date());
            try { transaction().executeWithoutResult(s -> tasks.insert(pending)); task = pending; }
            catch (DuplicateKeyException concurrent) {
                task = find(tenant, user, dto.getIdempotencyKey());
                if (task == null) throw new BaseException("创建任务发生并发冲突，请刷新后重试");
                if (!hash.equals(task.getRequestHash())) throw new BaseException("幂等键已用于不同的建库请求");
                if ("SUCCEEDED".equals(task.getStatus())) return ownedResult(task);
            }
        }
        if (!"PENDING".equals(task.getStatus())) throw new BaseException("建库任务 " + task.getTaskId() + " 处理中或结果未知，请核对后处理，不会重复创建");
        final KnowledgeProvisionTask current = task;
        if (StringUtils.isBlank(current.getExternalCode())) {
            Integer claimed = transaction().execute(s -> tasks.update(null, new LambdaUpdateWrapper<KnowledgeProvisionTask>()
                .eq(KnowledgeProvisionTask::getTaskId, current.getTaskId()).eq(KnowledgeProvisionTask::getStatus, "PENDING")
                .set(KnowledgeProvisionTask::getStatus, "CREATING").set(KnowledgeProvisionTask::getUpdatedAt, new Date())));
            if (!Objects.equals(claimed, 1)) throw new BaseException("建库任务已在处理，请勿重复提交");
            try {
                String externalCode = providers.create(provider, "BYAI_" + current.getTaskId(), dto.getResourceName(), dto.getResourceDesc());
                transaction().executeWithoutResult(s -> tasks.update(null, new LambdaUpdateWrapper<KnowledgeProvisionTask>()
                    .eq(KnowledgeProvisionTask::getTaskId, current.getTaskId()).eq(KnowledgeProvisionTask::getStatus, "CREATING")
                    .set(KnowledgeProvisionTask::getExternalCode, externalCode).set(KnowledgeProvisionTask::getStatus, "PENDING")
                    .set(KnowledgeProvisionTask::getUpdatedAt, new Date())));
                current.setExternalCode(externalCode);
            } catch (RuntimeException failure) {
                transaction().executeWithoutResult(s -> tasks.update(null, new LambdaUpdateWrapper<KnowledgeProvisionTask>()
                    .eq(KnowledgeProvisionTask::getTaskId, current.getTaskId()).eq(KnowledgeProvisionTask::getStatus, "CREATING")
                    .set(KnowledgeProvisionTask::getStatus, "UNKNOWN").set(KnowledgeProvisionTask::getError, "外部建库结果无法确认")
                    .set(KnowledgeProvisionTask::getUpdatedAt, new Date())));
                throw new BaseException("建库任务 " + current.getTaskId() + " 结果未知，请核对提供方，不会自动重试");
            }
        }
        SsResource result = transaction().execute(s -> {
            int claimed = tasks.update(null, new LambdaUpdateWrapper<KnowledgeProvisionTask>()
                .eq(KnowledgeProvisionTask::getTaskId, current.getTaskId()).eq(KnowledgeProvisionTask::getStatus, "PENDING")
                .set(KnowledgeProvisionTask::getStatus, "CREATING"));
            if (claimed != 1) throw new BaseException("建库任务已在保存，请刷新后查看");
            SsResource saved = datasets.saveProvisionedDataset(dto, provider, current.getExternalCode());
            tasks.update(null, new LambdaUpdateWrapper<KnowledgeProvisionTask>().eq(KnowledgeProvisionTask::getTaskId, current.getTaskId())
                .set(KnowledgeProvisionTask::getResourceId, saved.getResourceId()).set(KnowledgeProvisionTask::getStatus, "SUCCEEDED")
                .set(KnowledgeProvisionTask::getUpdatedAt, new Date()));
            return saved;
        });
        if (dto.getPublishScope() != null) {
            try { publications.submitLocal(result.getResourceId(), dto.getPublishScope()); }
            catch (BaseException error) { result.setPublicationError("知识库已创建，发布尚未提交，请从发布管理继续处理"); }
        }
        return result;
    }
    private KnowledgeProvisionTask find(Long tenant, Long user, String key) {
        // NOT_SUPPORTED can still bind a MyBatis session via Spring synchronization. Read in a fresh
        // short transaction so the first missing-task result is not reused after a competing commit.
        return transaction().execute(s -> tasks.selectOne(new LambdaQueryWrapper<KnowledgeProvisionTask>()
            .eq(KnowledgeProvisionTask::getTenantId, tenant).eq(KnowledgeProvisionTask::getApplicantId, user)
            .eq(KnowledgeProvisionTask::getIdempotencyKey, key)));
    }
    private SsResource ownedResult(KnowledgeProvisionTask task) {
        SsResource row = resources.selectById(task.getResourceId());
        if (row == null || !Objects.equals(row.getComAcctId(), task.getTenantId()) || !Objects.equals(row.getCreateBy(), task.getApplicantId())
            || Objects.equals(row.getResourceStatus(), -1)) throw new BaseException("已创建的知识库已删除或归属改变，请核对任务");
        return row;
    }
}
