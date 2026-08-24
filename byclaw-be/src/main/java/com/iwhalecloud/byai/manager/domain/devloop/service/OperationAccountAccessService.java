package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import com.iwhalecloud.byai.manager.entity.sandbox.SsSandboxRecord;
import com.iwhalecloud.byai.manager.mapper.sandbox.SsSandboxRecordMapper;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.List;
import java.util.Objects;

/** 统一判定运营账号的用户访问权限和沙箱可用性。 */
@Service
public class OperationAccountAccessService {

    @Autowired
    private OperationAccountService operationAccountService;

    @Autowired
    private SsSandboxRecordMapper sandboxRecordMapper;

    /** 判断当前用户是否能访问指定项目下的账号。 */
    public boolean canAccess(OperationAccount account, Long projectId, Long userId) {
        if (account == null || account.getProjectId() == null || projectId == null || userId == null) {
            return false;
        }
        return Objects.equals(account.getProjectId(), projectId)
            && (account.getCreateBy() == null || Objects.equals(account.getCreateBy(), userId));
    }

    /** 查询有效账号，并仅在当前用户可访问时返回。 */
    public OperationAccount findAccessible(Long accountId, Long projectId, Long userId) {
        if (accountId == null || projectId == null || userId == null) {
            return null;
        }
        OperationAccount account = operationAccountService.findById(accountId);
        return canAccess(account, projectId, userId) ? account : null;
    }

    /** 查询当前用户在项目下可访问的有效账号。 */
    public List<OperationAccount> listAccessible(Long projectId, Long userId) {
        if (projectId == null || userId == null) {
            return List.of();
        }
        return operationAccountService.listAccessibleByProjectId(projectId, userId);
    }

    /** 判断账号未绑定沙箱，或绑定了当前用户仍在运行的沙箱。 */
    public boolean hasUsableSandbox(OperationAccount account, String currentUserCode) {
        if (account == null) {
            return false;
        }
        if (StringUtils.isBlank(account.getConfig())) {
            return true;
        }

        final JSONObject config;
        try {
            config = JSON.parseObject(account.getConfig());
        } catch (RuntimeException exception) {
            return false;
        }
        if (config == null) {
            return false;
        }

        String sandboxId = config.getString("browserSandboxId");
        if (StringUtils.isBlank(sandboxId)) {
            return true;
        }
        if (StringUtils.isBlank(currentUserCode)) {
            return false;
        }

        List<SsSandboxRecord> records = sandboxRecordMapper.selectRunningByUser(currentUserCode);
        return records != null && records.stream()
            .filter(Objects::nonNull)
            .anyMatch(record -> StringUtils.equals(record.getSandboxId(), sandboxId.trim()));
    }
}
