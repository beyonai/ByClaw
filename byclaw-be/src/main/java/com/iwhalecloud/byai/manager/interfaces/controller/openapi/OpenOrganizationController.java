package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.application.service.openapi.OpenOrganizationApplicationService;
import com.iwhalecloud.byai.manager.application.service.organization.OrganizationApplicationService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenOrgDTO;
import com.iwhalecloud.byai.manager.dto.organization.DelOrgDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.qo.organization.OrgManagerQo;
import com.iwhalecloud.byai.manager.qo.organization.OrgTreeQo;
import com.iwhalecloud.byai.manager.vo.organization.OrgManagerVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-04-16 16:12:30
 * @description TODO
 */
@RestController
@RequestMapping("/open/api")
public class OpenOrganizationController {

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private OrganizationApplicationService organizationApplicationService;

    @Autowired
    private OpenOrganizationApplicationService openOrganizationApplicationService;

    /**
     * 查询组织
     *
     * @param orgTreeQo 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "查询发布组织")
    @RequestMapping(value = "/getOrgTree", method = RequestMethod.POST)
    public ResponseUtil getOrgTree(@RequestBody OrgTreeQo orgTreeQo) {
        return ResponseUtil.successResponse(organizationApplicationService.getOrgTree(orgTreeQo));
    }

    /**
     * 新增组织
     *
     * @param openOrgDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "新增组织")
    @RequestMapping(value = "/addOrg", method = RequestMethod.POST)
    public ResponseUtil<Long> addOrg(@Validated(Add.class) @RequestBody OpenOrgDTO openOrgDTO) {
        Long orgId = openOrganizationApplicationService.addOrg(openOrgDTO);
        return ResponseUtil.successResponse(I18nUtil.get("organization.add.success"), orgId);
    }

    /**
     * 更新组织
     *
     * @param openOrgDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "修改组织")
    @RequestMapping(value = "/updateOrg", method = RequestMethod.POST)
    public ResponseUtil<Long> updateOrg(@Validated(Mod.class) @RequestBody OpenOrgDTO openOrgDTO) {
        Long orgId = openOrganizationApplicationService.updateOrg(openOrgDTO);
        return ResponseUtil.successResponse(I18nUtil.get("organization.modify.success"), orgId);
    }

    /**
     * 删除组织
     *
     * @param delOrgDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "删除组织")
    @RequestMapping(value = "/delOrg", method = RequestMethod.POST)
    public ResponseUtil delOrg(@Validated @RequestBody DelOrgDTO delOrgDTO) {
        openOrganizationApplicationService.delOrg(delOrgDTO.getOrgId());
        return ResponseUtil.successResponse(I18nUtil.get("organization.delete.success"));
    }

    /**
     * 组织管理查询组织
     *
     * @param params 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "查询组织详情")
    @RequestMapping(value = "/qryOrgById", method = RequestMethod.POST)
    public ResponseUtil qryOrgById(@Validated @RequestBody Map<String, Object> params) {
        Long orgId = MapParamUtil.getLongValue(params, "orgId");
        return ResponseUtil.successResponse(openOrganizationApplicationService.qryOrgById(orgId));
    }

    /**
     * @param orgManagerQo 查询发布的组织下的管理员或者业务员
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "API调用", description = "查询发布组织管理员和业务员")
    @RequestMapping(value = "/getPublishByOrgId", method = RequestMethod.POST)
    public ResponseUtil getPublishByOrgId(@RequestBody @Validated OrgManagerQo orgManagerQo) {
        List<OrgManagerVo> orgManagers = organizationService.getPublishByOrgId(orgManagerQo);
        return ResponseUtil.successResponse(orgManagers);
    }

}
