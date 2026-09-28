package com.iwhalecloud.byai.manager.application.service.enterprise;

import com.iwhalecloud.byai.common.constants.enterprise.TenantUserMembershipRole;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.enterprise.service.TenantUserMembershipService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseInfoDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseQueryDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseRemoveDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseSwitchDTO;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.vo.enterprise.UserEnterpriseVo;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.List;

/**
 * 企业信息应用服务，组合企业领域服务与租户成员关系。
 */
@Service
public class EnterpriseInfoApplicationService {

    /** 系统预置默认企业，不允许删除 */
    private static final Long DEFAULT_ENTERPRISE_ID = 1L;

    private static final String SWITCH_OFF = "0";

    @Autowired
    private EnterpriseInfoService enterpriseInfoService;

    @Autowired
    private TenantUserMembershipService tenantUserMembershipService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    @Autowired
    private UserService userService;

    /**
     * 获取企业信息；未传企业标识时默认查询系统预置企业。
     *
     * @param queryDTO 查询入参
     * @return 企业信息
     */
    public EnterpriseInfo getEnterprise(EnterpriseQueryDTO queryDTO) {
        Long enterpriseId = queryDTO != null && queryDTO.getEnterpriseId() != null
            ? queryDTO.getEnterpriseId() : DEFAULT_ENTERPRISE_ID;
        return enterpriseInfoService.findById(enterpriseId);
    }

    /**
     * 查询当前登录用户关联的企业列表。
     *
     * @return 企业简要信息列表（企业标识、名称、编码、角色、成员状态）
     */
    public List<UserEnterpriseVo> listUserEnterprises() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        return tenantUserMembershipService.listUserEnterprises(userId);
    }

    /**
     * 新增企业信息；任意登录用户可创建，创建成功后将当前用户设为该企业 OWNER。
     *
     * @param enterpriseInfoDTO 新增入参
     * @return 新建企业标识
     */
    @Transactional(rollbackFor = Exception.class)
    public Long create(EnterpriseInfoDTO enterpriseInfoDTO) {
        assertComAcctCodeUnique(enterpriseInfoDTO.getComAcctCode(), null);

        EnterpriseInfo enterpriseInfo = buildEnterpriseForCreate(enterpriseInfoDTO);
        enterpriseInfoService.create(enterpriseInfo);

        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        tenantUserMembershipService.add(currentUserId, enterpriseInfo.getEnterpriseId(),
            TenantUserMembershipRole.OWNER, currentUserId);

        return enterpriseInfo.getEnterpriseId();
    }

    /**
     * 修改企业信息。
     *
     * @param enterpriseInfoDTO 修改入参
     */
    @Transactional(rollbackFor = Exception.class)
    public void update(EnterpriseInfoDTO enterpriseInfoDTO) {
        assertPlatformManager();
        Long enterpriseId = enterpriseInfoDTO.getEnterpriseId();
        requireEnterprise(enterpriseId);
        assertComAcctCodeUnique(enterpriseInfoDTO.getComAcctCode(), enterpriseId);

        enterpriseInfoService.update(buildEnterpriseForUpdate(enterpriseInfoDTO));
    }

    /**
     * 删除企业信息，并清理该企业下的租户成员关系；系统预置默认企业不允许删除。
     *
     * @param removeDTO 删除入参
     */
    @Transactional(rollbackFor = Exception.class)
    public void remove(EnterpriseRemoveDTO removeDTO) {
        assertPlatformManager();
        Long enterpriseId = removeDTO.getEnterpriseId();
        if (DEFAULT_ENTERPRISE_ID.equals(enterpriseId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("enterprise.delete.default.forbidden"));
        }
        requireEnterprise(enterpriseId);

        tenantUserMembershipService.removeByEnterpriseId(enterpriseId);
        enterpriseInfoService.removeById(enterpriseId);
    }

    /**
     * 获取企业 Logo 并写入响应流。
     *
     * @param enterpriseId 企业标识
     * @param response HTTP 响应
     */
    public void getEnterpriseLogoData(Long enterpriseId, HttpServletResponse response) {
        enterpriseInfoService.writeLogoData(enterpriseId, response);
    }

    /**
     * 切换当前登录用户的企业（租户）；仅允许切换至本人 ACTIVE 成员身份的企业。
     *
     * @param switchDTO 切换入参
     * @param session HTTP 会话
     * @return 切换后的企业标识
     */
    public Long switchTo(EnterpriseSwitchDTO switchDTO, HttpSession session) {
        Long enterpriseId = switchDTO.getEnterpriseId();
        requireEnterprise(enterpriseId);

        Long userId = CurrentUserHolder.getCurrentUserId();
        if (tenantUserMembershipService.findActiveByUserIdAndEnterpriseId(userId, enterpriseId) == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("enterprise.membership.required"));
        }

        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("enterprise.login.required"));
        }

        loginInfo.setEnterpriseId(enterpriseId);
        loginInfo.setComAcctId(enterpriseId);
        CurrentUserHolder.setLoginInfo(loginInfo);
        loginApplicationService.shareSession(session, loginInfo);

        Users users = userService.findById(userId);
        if (users != null) {
            ShareCacheUtil.setShareShareBfmUser(users, enterpriseId);
        }

        return enterpriseId;
    }

    /**
     * 根据新增入参组装企业实体，并设置默认开关。
     *
     * @param dto 新增入参
     * @return 待持久化的企业实体
     */
    private EnterpriseInfo buildEnterpriseForCreate(EnterpriseInfoDTO dto) {
        EnterpriseInfo enterpriseInfo = new EnterpriseInfo();
        fillCommonFields(enterpriseInfo, dto);
        enterpriseInfo.setDemoSwitch(SWITCH_OFF);
        enterpriseInfo.setProjectSwitch(SWITCH_OFF);
        fillLogoIfPresent(enterpriseInfo, dto.getLogoData());
        return enterpriseInfo;
    }

    /**
     * 根据修改入参组装企业实体。
     *
     * @param dto 修改入参
     * @return 待更新的企业实体
     */
    private EnterpriseInfo buildEnterpriseForUpdate(EnterpriseInfoDTO dto) {
        EnterpriseInfo enterpriseInfo = new EnterpriseInfo();
        enterpriseInfo.setEnterpriseId(dto.getEnterpriseId());
        fillCommonFields(enterpriseInfo, dto);
        fillLogoIfPresent(enterpriseInfo, dto.getLogoData());
        return enterpriseInfo;
    }

    /**
     * 填充企业名称、编码、地址、系统名称等公共字段。
     *
     * @param enterpriseInfo 企业实体
     * @param dto 入参
     */
    private void fillCommonFields(EnterpriseInfo enterpriseInfo, EnterpriseInfoDTO dto) {
        enterpriseInfo.setComAcctName(StringUtils.trim(dto.getComAcctName()));
        enterpriseInfo.setComAcctCode(StringUtils.trim(dto.getComAcctCode()));
        enterpriseInfo.setComAcctAddress(dto.getComAcctAddress());
        enterpriseInfo.setSystemName(dto.getSystemName());
    }

    /**
     * 若传入 Logo 则写入企业实体。
     *
     * @param enterpriseInfo 企业实体
     * @param logoData Logo 二进制，可为 null
     */
    private void fillLogoIfPresent(EnterpriseInfo enterpriseInfo, byte[] logoData) {
        if (logoData == null || logoData.length == 0) {
            return;
        }
        enterpriseInfo.setLogoData(logoData);
    }

    /**
     * 校验企业存在，不存在则抛出业务异常。
     *
     * @param enterpriseId 企业标识
     * @return 已存在的企业信息
     */
    private EnterpriseInfo requireEnterprise(Long enterpriseId) {
        EnterpriseInfo existing = enterpriseInfoService.findById(enterpriseId);
        if (existing == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("enterprise.not.exist"));
        }
        return existing;
    }

    /**
     * 校验当前用户为平台管理员，否则抛出业务异常。
     */
    private void assertPlatformManager() {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("enterprise.edit.permission.deny"));
        }
    }

    /**
     * 校验企业编码唯一，已存在则抛出业务异常。
     *
     * @param comAcctCode 企业编码
     * @param excludeEnterpriseId 排除的企业标识，新增时传 null
     */
    private void assertComAcctCodeUnique(String comAcctCode, Long excludeEnterpriseId) {
        if (enterpriseInfoService.existsByComAcctCode(comAcctCode, excludeEnterpriseId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("enterprise.code.duplicate"));
        }
    }
}
