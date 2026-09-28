package com.iwhalecloud.byai.manager.interfaces.controller.enterprise;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.manager.application.service.enterprise.EnterpriseInfoApplicationService;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseInfoDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseQueryDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseRemoveDTO;
import com.iwhalecloud.byai.manager.dto.enterprise.EnterpriseSwitchDTO;
import com.iwhalecloud.byai.manager.entity.enterprise.EnterpriseInfo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.enterprise.UserEnterpriseVo;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.util.List;

/**
 * 企业信息管理
 */
@RestController
@RequestMapping("/system/enterprise")
public class EnterpriseController {

    @Autowired
    private EnterpriseInfoApplicationService enterpriseInfoApplicationService;

    /**
     * 获取企业信息；未传企业标识时默认查询系统预置企业。
     *
     * @param queryDTO 查询入参
     * @return 企业信息响应
     */
    @RequestMapping(value = "/getEnterprise", method = RequestMethod.POST)
    public ResponseUtil<EnterpriseInfo> getEnterprise(@RequestBody EnterpriseQueryDTO queryDTO) {
        return enterpriseInfoApplicationService.getEnterprise(queryDTO);
    }

    /**
     * 查询当前登录用户关联的企业列表。
     *
     * @return 企业简要信息列表（企业标识、名称、编码、角色、成员状态）
     */
    @RequestMapping(value = "/listUserEnterprises", method = RequestMethod.POST)
    public ResponseUtil<List<UserEnterpriseVo>> listUserEnterprises() {
        return enterpriseInfoApplicationService.listUserEnterprises();
    }

    /**
     * 新增企业信息；任意登录用户可创建，创建成功后将当前用户设为该企业 OWNER。
     *
     * @param enterpriseInfoDTO 新增入参
     * @return 新建企业标识
     */
    @RequestMapping(value = "/create", method = RequestMethod.POST)
    public ResponseUtil<Long> create(
        @Validated(Add.class) @RequestBody EnterpriseInfoDTO enterpriseInfoDTO) {
        return enterpriseInfoApplicationService.create(enterpriseInfoDTO);
    }

    /**
     * 修改企业信息。
     *
     * @param enterpriseInfoDTO 修改入参
     * @return 操作结果
     */
    @RequestMapping(value = "/update", method = RequestMethod.POST)
    public ResponseUtil<Void> update(
        @Validated(Mod.class) @RequestBody EnterpriseInfoDTO enterpriseInfoDTO) {
        return enterpriseInfoApplicationService.update(enterpriseInfoDTO);
    }

    /**
     * 删除企业信息，并清理该企业下的租户成员关系。
     *
     * @param removeDTO 删除入参
     * @return 操作结果
     */
    @RequestMapping(value = "/remove", method = RequestMethod.POST)
    public ResponseUtil<Void> remove(@Validated @RequestBody EnterpriseRemoveDTO removeDTO) {
        return enterpriseInfoApplicationService.remove(removeDTO);
    }

    /**
     * 获取企业 Logo 并写入响应流。
     *
     * @param enterpriseId 企业标识
     * @param response     HTTP 响应
     */
    @RequestMapping(value = "/getEnterpriseLogoData", method = RequestMethod.GET)
    public void getEnterpriseLogoData(@RequestParam("enterpriseId") Long enterpriseId, HttpServletResponse response) {
        enterpriseInfoApplicationService.getEnterpriseLogoData(enterpriseId, response);
    }

    /**
     * 切换当前登录用户的企业（租户）。
     *
     * @param switchDTO 切换入参
     * @param session   HTTP 会话
     * @return 切换后的企业标识
     */
    @RequestMapping(value = "/switch", method = RequestMethod.POST)
    public ResponseUtil<Long> switchTo(@Validated @RequestBody EnterpriseSwitchDTO switchDTO,
                                       HttpSession session) {
        return enterpriseInfoApplicationService.switchTo(switchDTO, session);
    }
}
