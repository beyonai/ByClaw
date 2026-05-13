package com.iwhalecloud.byai.manager.domain.enterprise.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.io.OutputStream;
import java.util.Map;

import com.iwhalecloud.byai.manager.mapper.enterprise.EnterpriseInfoMapper;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import jakarta.servlet.http.HttpServletResponse;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 企业信息管理接口
 */
@Service
public class EnterpriseInfoService {

    private static final Logger logger = LoggerFactory.getLogger(EnterpriseInfoService.class);


    @Autowired
    private EnterpriseInfoMapper enterpriseInfoMapper;

    /**
     * 获取企业信息
     *
     * @param params 入参
     * @return ResponseUtil
     */
    public ResponseUtil getEnterprise(Map<String, Object> params) {
        Long enterpriseId = MapUtils.getLong(params, "enterpriseId", 1L);
        EnterpriseInfo enterpriseInfo = enterpriseInfoMapper.selectById(enterpriseId);
        return ResponseUtil.successResponse(enterpriseInfo);
    }

    /**
     * 编辑企业信息
     *
     * @param enterpriseId 企业标识
     * @param comAcctName 企业名称
     * @param comAcctCode 企业编码
     * @param comAcctAddress 企业地址
     * @param systemName 系统名称
     * @param logoDataFile 系统标识文件
     * @return ResponseUtil
     */
    public ResponseUtil editEnterprise(Long enterpriseId, String comAcctName, String comAcctCode, String comAcctAddress,
        String systemName, MultipartFile logoDataFile) {

        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("enterprise.edit.permission.deny"));
        }

        try {
            EnterpriseInfo enterpriseInfo = new EnterpriseInfo();
            enterpriseInfo.setEnterpriseId(enterpriseId);
            enterpriseInfo.setComAcctName(comAcctName);
            enterpriseInfo.setComAcctCode(comAcctCode);
            enterpriseInfo.setComAcctAddress(comAcctAddress);
            enterpriseInfo.setSystemName(systemName);
            enterpriseInfo.setLogoData(logoDataFile != null ? logoDataFile.getBytes() : new byte[0]);
            enterpriseInfoMapper.updateById(enterpriseInfo);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
            return ResponseUtil.fail(e.getMessage());
        }
        return ResponseUtil.successResponse(I18nUtil.get("enterprise.update.success"));
    }

    /**
     * 获取企业Logo信息
     *
     * @param enterpriseId 企业标识
     * @param response 响应
     */
    public void getEnterpriseLogoData(Long enterpriseId, HttpServletResponse response) {
        EnterpriseInfo enterpriseInfo = enterpriseInfoMapper.selectById(enterpriseId);
        if (enterpriseInfo != null && enterpriseInfo.getLogoData() != null && enterpriseInfo.getLogoData().length > 0) {
            response.setContentType("image/png;charset=utf-8");
            // 自动关闭流
            try (OutputStream outputStream = response.getOutputStream();) {
                outputStream.write(enterpriseInfo.getLogoData());
                outputStream.flush();
            }
            catch (Exception e) {
                logger.error(e.getMessage(), e);
            }
        }
    }

    /**
     * @return 获取企业标识
     */
    public Long getEnterpriseId() {
        return enterpriseInfoMapper.getEnterpriseId();
    }

}
