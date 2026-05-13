package com.iwhalecloud.byai.manager.interfaces.controller.enterprise;

import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import jakarta.validation.constraints.Size;
import java.util.Map;

/**
 * 企业信息管理
 */
@RestController
@RequestMapping("/system/enterprise")
public class EnterpriseController {

    @Autowired
    private EnterpriseInfoService enterpriseInfoService;

    /**
     * 获取企业信息
     * 
     * @param params 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getEnterprise", method = RequestMethod.POST)
    public ResponseUtil getEnterprise(@RequestBody Map<String, Object> params) {
        return enterpriseInfoService.getEnterprise(params);
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
    @RequestMapping(value = "/editEnterprise", method = RequestMethod.POST)
    public ResponseUtil editEnterprise(@RequestParam("enterpriseId") Long enterpriseId,
        @RequestParam("comAcctName") @Size(max = 200, message = "{enterprisecontroller.comacctname.size}") String comAcctName,
        @RequestParam("comAcctCode") @Size(max = 100, message = "{enterprisecontroller.comacctcode.size}") String comAcctCode,
        @RequestParam(value = "comAcctAddress", required = false) String comAcctAddress,
        @RequestParam(value = "systemName", required = false) @Size(max = 255,
            message = "{enterprisecontroller.systemname.size}") String systemName,
        @RequestParam(value = "logoData", required = false) MultipartFile logoDataFile) {
        return enterpriseInfoService.editEnterprise(enterpriseId, comAcctName, comAcctCode, comAcctAddress, systemName,
            logoDataFile);
    }

    /**
     * 获取企业Logo信息
     * 
     * @param enterpriseId 企业标识
     * @param response 响应
     */
    @RequestMapping(value = "/getEnterpriseLogoData", method = RequestMethod.GET)
    public void getEnterpriseLogoData(@RequestParam("enterpriseId") Long enterpriseId, HttpServletResponse response) {
        enterpriseInfoService.getEnterpriseLogoData(enterpriseId, response);
    }
}
