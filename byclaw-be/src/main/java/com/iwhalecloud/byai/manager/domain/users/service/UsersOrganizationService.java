package com.iwhalecloud.byai.manager.domain.users.service;

import cn.hutool.core.collection.CollUtil;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.mapper.users.UsersOrganizationMapper;
import com.iwhalecloud.byai.manager.domain.event.user.UserOrganizationChangedEvent;
import com.iwhalecloud.byai.manager.entity.users.UsersOrganization;
import com.iwhalecloud.byai.manager.vo.users.UsersOrgPostVo;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.context.ApplicationEventPublisher;
import java.util.ArrayList;
import java.util.HashMap;
import org.springframework.stereotype.Service;
import java.util.List;
import java.util.Map;
import java.util.stream.Collectors;

/**
 * @author he.duming
 * @date 2025-04-17 16:41:21
 * @description 用户关联组织岗位服务类
 */
@Service
public class UsersOrganizationService {

    @Autowired
    private UsersOrganizationMapper usersOrganizationMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private ApplicationEventPublisher eventPublisher;

    /**
     * 用户关联组织岗位
     * @param userId 用户标识
     * @param orgId 组织标识
     * @param userTypeList 用户角色
     * @param positionId 岗位标识
     */
    public void addUsersOrganization(Long userId, Long orgId, List<String> userTypeList, Long positionId) {

        // 检查用户是否已经关联过组织,关联过的更新关系
        LambdaQueryWrapper<UsersOrganization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UsersOrganization::getUserId, userId);
        queryWrapper.eq(UsersOrganization::getOrgId, orgId);


        usersOrganizationMapper.delete(queryWrapper);
        // 重新构建关联关系
        List<UsersOrganization> usersOrganizations = new ArrayList<>(3);
        userTypeList.forEach(userType -> {
            UsersOrganization usersOrganization = new UsersOrganization();
            usersOrganization.setId(SequenceService.nextVal());
            usersOrganization.setUserId(userId);
            usersOrganization.setOrgId(orgId);
            usersOrganization.setUserType(userType);
            usersOrganization.setPositionId(positionId);
            usersOrganizations.add(usersOrganization);
        });
        usersOrganizationMapper.saveBatch(usersOrganizations);
        publishOrganizationChanged(List.of(userId));
    }

    /**
     * 移除用户信息
     */
    public void removeByPrimaryKey(Long id) {
        if (id == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("userorg.remove.id.notnull"));
        }
        UsersOrganization usersOrganization = usersOrganizationMapper.selectById(id);
        usersOrganizationMapper.deleteById(id);
        if (usersOrganization != null) {
            publishOrganizationChanged(List.of(usersOrganization.getUserId()));
        }
    }

    /**
     * 移除用户信息 批量
     */
    public void removeByPrimaryKeys(List<Long> ids) {
        if (CollUtil.isEmpty(ids)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("userorg.remove.id.notnull"));
        }
        List<UsersOrganization> usersOrganizations = usersOrganizationMapper.selectBatchIds(ids);
        usersOrganizationMapper.deleteBatchIds(ids);
        publishOrganizationChanged(usersOrganizations.stream().map(UsersOrganization::getUserId).toList());
    }

    /**
     * 查询用户的关联关系
     *
     * @param userId 用户标识
     * @return List<Users>
     */
    public List<UsersOrganization> findByUserId(Long userId) {
        LambdaQueryWrapper<UsersOrganization> queryWrapper = new LambdaQueryWrapper<UsersOrganization>()
            .eq(UsersOrganization::getUserId, userId);
        return usersOrganizationMapper.selectList(queryWrapper);
    }

    /**
     * 查询用户所在的组织，按照组织分组
     *
     * @param userId 用户标识
     * @return List<Users>
     */
    public Map<Long, List<UsersOrganization>> findGroupByOrgId(Long userId) {
        List<UsersOrganization> usersOrganizations = this.findByUserId(userId);
        if (CollUtil.isEmpty(usersOrganizations)) {
            return new HashMap<>();
        }
        return usersOrganizations.stream().collect(Collectors.groupingBy(UsersOrganization::getOrgId));
    }

    /**
     * 分页查询用户关联组织信息
     *
     * @param page 分页信息
     * @param queryWrapper 查询对象
     * @return List<Users>
     */
    public List<UsersOrganization> selectList(IPage<UsersOrganization> page, Wrapper<UsersOrganization> queryWrapper) {
        return usersOrganizationMapper.selectList(page, queryWrapper);
    }

    /**
     * 分页查询用户关联组织信息
     *
     * @return List<Users>
     */
    public List<UsersOrgPostVo> selectUsersOrganizationVoList() {
        return usersOrganizationMapper.selectUsersOrganizationVoList();
    }

    /**
     * 批量查询用户的关联关系
     *
     * @param userIds 用户ID列表
     * @return List<UsersOrganization>
     */
    public List<UsersOrganization> findByUserIds(List<Long> userIds) {
        if (userIds == null || userIds.isEmpty()) {
            return new ArrayList<>();
        }
        LambdaQueryWrapper<UsersOrganization> queryWrapper = new LambdaQueryWrapper<UsersOrganization>()
            .in(UsersOrganization::getUserId, userIds);
        return usersOrganizationMapper.selectList(queryWrapper);
    }

    /**
     * 保存用户关联关系
     *
     * @param usersOrganization 组织关联关系
     */
    public void save(UsersOrganization usersOrganization) {
        if (usersOrganization.getId() == null) {
            usersOrganization.setId(SequenceService.nextVal());
        }
        usersOrganizationMapper.insert(usersOrganization);
        publishOrganizationChanged(List.of(usersOrganization.getUserId()));
    }

    /**
     * 保存用户关联关系 批量
     *
     * @param usersOrganizations 组织关联关系
     */
    public void saveBatch(List<UsersOrganization> usersOrganizations) {
        for (UsersOrganization usersOrganization : usersOrganizations) {
            if (usersOrganization.getId() == null) {
                usersOrganization.setId(SequenceService.nextVal());
            }
        }
        usersOrganizationMapper.saveBatch(usersOrganizations);
        publishOrganizationChanged(usersOrganizations.stream().map(UsersOrganization::getUserId).toList());
    }

    /**
     * 更新用户关联关系
     *
     * @param usersOrganization 组织关联关系
     */
    public void update(UsersOrganization usersOrganization) {
        UsersOrganization history = usersOrganizationMapper.selectById(usersOrganization.getId());
        usersOrganizationMapper.updateById(usersOrganization);
        List<Long> userIds = new ArrayList<>();
        if (history != null) {
            userIds.add(history.getUserId());
        }
        userIds.add(usersOrganization.getUserId());
        publishOrganizationChanged(userIds);
    }

    /**
     * 移除组织关联用户信息
     * 
     * @param orgId 组织标识
     */
    public void removeByOrgId(Long orgId) {
        LambdaQueryWrapper<UsersOrganization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UsersOrganization::getOrgId, orgId);
        List<UsersOrganization> usersOrganizations = usersOrganizationMapper.selectList(queryWrapper);
        if (CollUtil.isNotEmpty(usersOrganizations)) {
            for (UsersOrganization usersOrganization : usersOrganizations) {
                usersOrganizationMapper.deleteById(usersOrganization.getId());
            }
            publishOrganizationChanged(usersOrganizations.stream().map(UsersOrganization::getUserId).toList());
        }
    }

    /**
     * 查询组织关联的所有用户
     * 
     * @param orgId 组织标识
     * @return List<UsersOrganization>
     */
    public List<UsersOrganization> findByOrgId(Long orgId) {
        LambdaQueryWrapper<UsersOrganization> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UsersOrganization::getOrgId, orgId);
        return usersOrganizationMapper.selectList(queryWrapper);
    }

    private void publishOrganizationChanged(List<Long> userIds) {
        if (CollUtil.isEmpty(userIds)) {
            return;
        }
        List<Long> effectiveUserIds = userIds.stream().filter(java.util.Objects::nonNull).distinct().toList();
        if (!effectiveUserIds.isEmpty()) {
            eventPublisher.publishEvent(new UserOrganizationChangedEvent(this, effectiveUserIds));
        }
    }

}
