package com.iwhalecloud.byai.manager.domain.devloop.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.devloop.OperationAccount;
import com.iwhalecloud.byai.manager.mapper.devloop.OperationAccountMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/** 运营账号领域服务，统一管理项目账号的创建、编辑和查询。 */
@Service
public class OperationAccountService {

    @Autowired
    private OperationAccountMapper operationAccountMapper;

    @Autowired
    private SequenceService sequenceService;

    /** 创建账号并设置未登录的初始状态。 */
    public OperationAccount create(OperationAccount account) {
        account.setAccountId(sequenceService.nextVal());
        account.setCreateTime(new Date());
        account.setStatus("connected");
        account.setLoginStatus("offline");
        account.setStatusCd("00A");
        operationAccountMapper.insert(account);
        return account;
    }

    /** 查询单个有效账号。 */
    public OperationAccount findById(Long accountId) {
        OperationAccount account = operationAccountMapper.selectById(accountId);
        return account != null && "00A".equals(account.getStatusCd()) ? account : null;
    }

    /** 更新账号可编辑字段。 */
    public void update(OperationAccount account) {
        account.setUpdateTime(new Date());
        operationAccountMapper.updateById(account);
    }

    /** 软删除账号，保留历史运营需求和任务中的账号引用供后续追溯。 */
    public void delete(Long accountId, Long operatorId) {
        OperationAccount account = new OperationAccount();
        account.setAccountId(accountId);
        account.setStatus("disconnected");
        account.setLoginStatus("offline");
        account.setStatusCd("00X");
        account.setUpdateBy(operatorId);
        account.setUpdateTime(new Date());
        operationAccountMapper.updateById(account);
    }

    /** 查询项目下有效账号，最近新增的账号排在前面。 */
    public List<OperationAccount> listByProjectId(Long projectId) {
        LambdaQueryWrapper<OperationAccount> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(OperationAccount::getProjectId, projectId).eq(OperationAccount::getStatusCd, "00A")
            .orderByDesc(OperationAccount::getCreateTime);
        return operationAccountMapper.selectList(wrapper);
    }

    /** 查询当前用户可见的项目有效账号，同时兼容没有创建人信息的历史账号。 */
    public List<OperationAccount> listAccessibleByProjectId(Long projectId, Long userId) {
        if (projectId == null || userId == null) {
            return List.of();
        }
        LambdaQueryWrapper<OperationAccount> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(OperationAccount::getProjectId, projectId).eq(OperationAccount::getStatusCd, "00A")
            .and(owner -> owner.eq(OperationAccount::getCreateBy, userId)
                .or().isNull(OperationAccount::getCreateBy))
            .orderByDesc(OperationAccount::getCreateTime);
        return operationAccountMapper.selectList(wrapper);
    }
}
