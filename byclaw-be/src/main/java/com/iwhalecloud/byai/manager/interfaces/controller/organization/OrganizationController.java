package com.iwhalecloud.byai.manager.interfaces.controller.organization;

import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RestController;

import com.iwhalecloud.byai.manager.application.service.organization.OrganizationApplicationService;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.qo.organization.OrgManagerQo;
import com.iwhalecloud.byai.manager.qo.organization.OrgTreeQo;
import com.iwhalecloud.byai.manager.qo.organization.SearchOrgQo;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.vo.organization.OrgManagerVo;
import com.iwhalecloud.byai.manager.dto.organization.AddUserByOrgDTO;
import com.iwhalecloud.byai.manager.dto.organization.DelOrgDTO;
import com.iwhalecloud.byai.common.annotation.Add;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.annotation.Mod;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;

/**
 * 组织控制器
 */
@RestController
@RequestMapping("/system/organization")
public class OrganizationController {

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private OrganizationApplicationService organizationApplicationService;

    /**
     * 新增组织
     *
     * @param organization 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "新增组织")
    @RequestMapping(value = "/addOrg", method = RequestMethod.POST)
    public ResponseUtil addOrg(@Validated(Add.class) @RequestBody Organization organization) {
        return organizationApplicationService.addOrg(organization);
    }

    /**
     * 更新组织
     *
     * @param organization 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "修改组织")
    @RequestMapping(value = "/updateOrg", method = RequestMethod.POST)
    public ResponseUtil updateOrg(@Validated(Mod.class) @RequestBody Organization organization) {
        organizationApplicationService.updateOrg(organization);
        return ResponseUtil.success(I18nUtil.get("organization.update.success"));

    }

    /**
     * 删除组织
     *
     * @param delOrgDTO 入参
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "删除组织")
    @RequestMapping(value = "/delOrg", method = RequestMethod.POST)
    public ResponseUtil delOrg(@Validated @RequestBody DelOrgDTO delOrgDTO) {
        organizationApplicationService.delOrg(delOrgDTO.getOrgId());
        return ResponseUtil.successResponse();
    }

    /**
     * 得到顶层组织的orgId
     *
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getFirstOrgId", method = RequestMethod.GET)
    public ResponseUtil getFirstOrgId() {
        Long firstOrgId = organizationService.getFirstOrgId();
        return ResponseUtil.successResponse(I18nUtil.get("organization.query.root.success"), firstOrgId);
    }

    /**
     * 查询组织
     *
     * @param searchOrgQo 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/searchOrg", method = RequestMethod.POST)
    public ResponseUtil searchOrg(@RequestBody @Validated SearchOrgQo searchOrgQo) {
        return ResponseUtil.successResponse(organizationApplicationService.searchOrg(searchOrgQo));
    }

    /**
     * 查询组织）
     * @param orgTreeQo 入参
     * @return ResponseUtil
     */
    @RequestMapping(value = "/getOrgTree", method = RequestMethod.POST)
    public ResponseUtil getOrgTree(@RequestBody OrgTreeQo orgTreeQo) {
        return ResponseUtil.successResponse(organizationApplicationService.getOrgTree(orgTreeQo));
    }

    /***
     * 从组织中选择成员添加
     *
     * @param addUserByOrgDTO 新增对象
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "组织添加成员")
    @RequestMapping(value = "/addUserByOrg", method = RequestMethod.POST)
    public ResponseUtil addUserByOrg(@RequestBody @Validated AddUserByOrgDTO addUserByOrgDTO) {
        return organizationApplicationService.addUserByOrg(addUserByOrgDTO);
    }

    /**
     * @param orgManagerQo 组织归属管理
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "归属组织管理给")
    @RequestMapping(value = "/getOrgManager", method = RequestMethod.POST)
    public ResponseUtil qryOrgManager(@RequestBody @Validated OrgManagerQo orgManagerQo) {
        List<OrgManagerVo> orgManagers = organizationService.qryOrgManager(orgManagerQo);
        return ResponseUtil.successResponse(orgManagers);
    }

    /**
     * @param orgManagerQo 查询发布的组织下的管理员或者业务员
     * @return ResponseUtil
     */
    @ManageLogAnnotation(name = "组织管理", description = "查询发布的组织下的管理员或者业务员")
    @RequestMapping(value = "/getPublishByOrgId", method = RequestMethod.POST)
    public ResponseUtil getPublishByOrgId(@RequestBody @Validated OrgManagerQo orgManagerQo) {
        List<OrgManagerVo> orgManagers = organizationService.getPublishByOrgId(orgManagerQo);
        return ResponseUtil.successResponse(orgManagers);
    }

    @ManageLogAnnotation(name = "是否有组织管理权限", description = "当前用户是否有组织管理权限")
    @RequestMapping(value = "/isOrgManager", method = RequestMethod.GET)
    public ResponseUtil isOrgManager() {
        return ResponseUtil.success(organizationService.getOrganizationManManager());
    }

}
