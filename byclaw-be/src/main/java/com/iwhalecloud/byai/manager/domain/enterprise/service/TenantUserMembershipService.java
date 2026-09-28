package com.iwhalecloud.byai.manager.domain.enterprise.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.enterprise.TenantUserMembershipRole;
import com.iwhalecloud.byai.common.constants.enterprise.TenantUserMembershipStatus;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import com.iwhalecloud.byai.manager.mapper.enterprise.TenantUserMembershipMapper;
import com.iwhalecloud.byai.manager.vo.enterprise.UserEnterpriseVo;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.Collections;
import java.util.Date;
import java.util.List;

/**
 * 用户与企业租户成员关系领域服务。
 */
@Service
public class TenantUserMembershipService {

    @Autowired
    private TenantUserMembershipMapper tenantUserMembershipMapper;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 新增有效成员关系；同一企业下用户已存在有效关系则直接返回。
     *
     * @param userId 用户标识
     * @param enterpriseId 企业租户标识
     * @param role 租户角色 OWNER/ADMIN/MEMBER
     * @param createdBy 操作人
     * @return 成员关系
     */
    public TenantUserMembership add(Long userId, Long enterpriseId, String role, Long createdBy) {
        if (userId == null || enterpriseId == null || createdBy == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                "userId, enterpriseId and createdBy are required");
        }
        String normalizedRole = StringUtils.upperCase(StringUtils.trimToEmpty(role));
        if (!TenantUserMembershipRole.ALL.contains(normalizedRole)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                "role must be OWNER, ADMIN or MEMBER");
        }
        TenantUserMembership existing = findActiveByUserIdAndEnterpriseId(userId, enterpriseId);
        if (existing != null) {
            return existing;
        }
        Date now = new Date();
        TenantUserMembership membership = new TenantUserMembership();
        membership.setMembershipId(sequenceService.nextVal());
        membership.setUserId(userId);
        membership.setEnterpriseId(enterpriseId);
        membership.setRole(normalizedRole);
        membership.setStatus(TenantUserMembershipStatus.ACTIVE);
        membership.setCreatedBy(createdBy);
        membership.setJoinedAt(now);
        membership.setUpdatedAt(now);
        tenantUserMembershipMapper.insert(membership);
        return membership;
    }

    /**
     * 按主键查询。
     *
     * @param membershipId 成员关系主键
     * @return 成员关系，不存在则返回 null
     */
    public TenantUserMembership findById(Long membershipId) {
        if (membershipId == null) {
            return null;
        }
        return tenantUserMembershipMapper.selectById(membershipId);
    }

    /**
     * 查询用户全部租户成员关系（含禁用）。
     *
     * @param userId 用户标识
     * @return 成员关系列表
     */
    public List<TenantUserMembership> findByUserId(Long userId) {
        if (userId == null) {
            return Collections.emptyList();
        }
        return tenantUserMembershipMapper.selectList(new LambdaQueryWrapper<TenantUserMembership>()
            .eq(TenantUserMembership::getUserId, userId)
            .orderByDesc(TenantUserMembership::getJoinedAt));
    }

    /**
     * 按用户标识联表查询关联企业简要信息。
     *
     * @param userId 用户标识
     * @return 企业简要信息列表
     */
    public List<UserEnterpriseVo> listUserEnterprises(Long userId) {
        if (userId == null) {
            return Collections.emptyList();
        }
        return tenantUserMembershipMapper.listUserEnterprises(userId);
    }

    /**
     * 查询用户当前有效的租户成员关系。
     *
     * @param userId 用户标识
     * @return 有效成员关系列表
     */
    public List<TenantUserMembership> findActiveByUserId(Long userId) {
        if (userId == null) {
            return Collections.emptyList();
        }
        return tenantUserMembershipMapper.selectList(new LambdaQueryWrapper<TenantUserMembership>()
            .eq(TenantUserMembership::getUserId, userId)
            .eq(TenantUserMembership::getStatus, TenantUserMembershipStatus.ACTIVE)
            .orderByDesc(TenantUserMembership::getJoinedAt));
    }

    /**
     * 查询企业下全部有效成员关系。
     *
     * @param enterpriseId 企业租户标识
     * @return 有效成员关系列表
     */
    public List<TenantUserMembership> findActiveByEnterpriseId(Long enterpriseId) {
        if (enterpriseId == null) {
            return Collections.emptyList();
        }
        return tenantUserMembershipMapper.selectList(new LambdaQueryWrapper<TenantUserMembership>()
            .eq(TenantUserMembership::getEnterpriseId, enterpriseId)
            .eq(TenantUserMembership::getStatus, TenantUserMembershipStatus.ACTIVE)
            .orderByDesc(TenantUserMembership::getJoinedAt));
    }

    /**
     * 查询用户在指定企业的有效成员关系。
     *
     * @param userId 用户标识
     * @param enterpriseId 企业租户标识
     * @return 有效成员关系，不存在则返回 null
     */
    public TenantUserMembership findActiveByUserIdAndEnterpriseId(Long userId, Long enterpriseId) {
        if (userId == null || enterpriseId == null) {
            return null;
        }
        return tenantUserMembershipMapper.selectOne(new LambdaQueryWrapper<TenantUserMembership>()
            .eq(TenantUserMembership::getUserId, userId)
            .eq(TenantUserMembership::getEnterpriseId, enterpriseId)
            .eq(TenantUserMembership::getStatus, TenantUserMembershipStatus.ACTIVE)
            .last("LIMIT 1"));
    }

    /**
     * 禁用成员关系（status=DISABLED）。
     *
     * @param userId 用户标识
     * @param enterpriseId 企业租户标识
     * @return 是否更新成功
     */
    public boolean disable(Long userId, Long enterpriseId) {
        TenantUserMembership existing = findActiveByUserIdAndEnterpriseId(userId, enterpriseId);
        if (existing == null) {
            return false;
        }
        existing.setStatus(TenantUserMembershipStatus.DISABLED);
        existing.setUpdatedAt(new Date());
        return tenantUserMembershipMapper.updateById(existing) > 0;
    }

    /**
     * 按主键物理删除。
     *
     * @param membershipId 成员关系主键
     */
    public void removeById(Long membershipId) {
        if (membershipId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "membershipId is required");
        }
        tenantUserMembershipMapper.deleteById(membershipId);
    }

    /**
     * 按主键批量物理删除。
     *
     * @param membershipIds 成员关系主键列表
     */
    public void removeByIds(List<Long> membershipIds) {
        if (CollectionUtils.isEmpty(membershipIds)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "membershipIds is required");
        }
        tenantUserMembershipMapper.deleteBatchIds(membershipIds);
    }

    /**
     * 按企业租户物理删除全部成员关系。
     *
     * @param enterpriseId 企业租户标识
     * @return 删除行数
     */
    public int removeByEnterpriseId(Long enterpriseId) {
        if (enterpriseId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, "enterpriseId is required");
        }
        return tenantUserMembershipMapper.delete(new LambdaQueryWrapper<TenantUserMembership>()
            .eq(TenantUserMembership::getEnterpriseId, enterpriseId));
    }
}
