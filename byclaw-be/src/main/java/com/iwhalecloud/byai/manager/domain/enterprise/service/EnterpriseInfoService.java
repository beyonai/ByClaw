package com.iwhalecloud.byai.manager.domain.enterprise.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.entity.enterprise.TenantUserMembership;
import com.iwhalecloud.byai.manager.mapper.enterprise.EnterpriseInfoMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.io.OutputStream;
import java.util.List;

/**
 * 企业信息领域服务，仅负责企业实体持久化。
 */
@Service
public class EnterpriseInfoService {

    private static final Logger logger = LoggerFactory.getLogger(EnterpriseInfoService.class);

    @Autowired
    private EnterpriseInfoMapper enterpriseInfoMapper;

    @Autowired
    private TenantUserMembershipService tenantUserMembershipService;

    @Autowired
    private SequenceService sequenceService;

    /**
     * 按主键查询企业。
     *
     * @param enterpriseId 企业标识
     * @return 企业信息，不存在则返回 null
     */
    public EnterpriseInfo findById(Long enterpriseId) {
        if (enterpriseId == null) {
            return null;
        }
        return enterpriseInfoMapper.selectById(enterpriseId);
    }

    /**
     * 判断企业编码是否已被占用。
     *
     * @param comAcctCode 企业编码
     * @param excludeEnterpriseId 排除的企业标识，可为 null
     * @return true 表示已存在
     */
    public boolean existsByComAcctCode(String comAcctCode, Long excludeEnterpriseId) {
        if (StringUtils.isBlank(comAcctCode)) {
            return false;
        }
        LambdaQueryWrapper<EnterpriseInfo> wrapper = new LambdaQueryWrapper<EnterpriseInfo>()
            .eq(EnterpriseInfo::getComAcctCode, StringUtils.trim(comAcctCode));
        if (excludeEnterpriseId != null) {
            wrapper.ne(EnterpriseInfo::getEnterpriseId, excludeEnterpriseId);
        }
        Long count = enterpriseInfoMapper.selectCount(wrapper);
        return count != null && count > 0;
    }

    /**
     * 新增企业并生成主键。
     *
     * @param enterpriseInfo 企业信息
     * @return 已持久化的企业信息
     */
    public EnterpriseInfo create(EnterpriseInfo enterpriseInfo) {
        enterpriseInfo.setEnterpriseId(sequenceService.nextVal());
        enterpriseInfoMapper.insert(enterpriseInfo);
        return enterpriseInfo;
    }

    /**
     * 按主键更新企业信息。
     *
     * @param enterpriseInfo 企业信息
     */
    public void update(EnterpriseInfo enterpriseInfo) {
        enterpriseInfoMapper.updateById(enterpriseInfo);
    }

    /**
     * 按主键删除企业。
     *
     * @param enterpriseId 企业标识
     */
    public void removeById(Long enterpriseId) {
        enterpriseInfoMapper.deleteById(enterpriseId);
    }

    /**
     * 写出企业 Logo 到响应流。
     *
     * @param enterpriseId 企业标识
     * @param response HTTP 响应
     */
    public void writeLogoData(Long enterpriseId, HttpServletResponse response) {
        EnterpriseInfo enterpriseInfo = findById(enterpriseId);
        if (enterpriseInfo == null || enterpriseInfo.getLogoData() == null
            || enterpriseInfo.getLogoData().length == 0) {
            return;
        }
        response.setContentType("image/png;charset=utf-8");
        try (OutputStream outputStream = response.getOutputStream()) {
            outputStream.write(enterpriseInfo.getLogoData());
            outputStream.flush();
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }

    /**
     * 查询当前库中最小的企业标识。
     *
     * @return 最小企业标识，表为空时可能为 null
     */
    public Long getEnterpriseId() {
        return enterpriseInfoMapper.getEnterpriseId();
    }

    /**
     * 解析指定用户的企业标识。用户已有有效租户关联时，取最早加入的一条；否则取当前库中最小企业标识。
     *
     * @param userId 用户标识，为空时直接取最小企业标识
     * @return 企业标识，表为空时可能为 null
     */
    public Long getEnterpriseId(Long userId) {
        if (userId != null) {
            List<TenantUserMembership> memberships = tenantUserMembershipService.findActiveByUserId(userId);
            for (int i = memberships.size() - 1; i >= 0; i--) {
                TenantUserMembership membership = memberships.get(i);
                if (membership != null && membership.getEnterpriseId() != null) {
                    return membership.getEnterpriseId();
                }
            }
        }
        return getEnterpriseId();
    }
}
