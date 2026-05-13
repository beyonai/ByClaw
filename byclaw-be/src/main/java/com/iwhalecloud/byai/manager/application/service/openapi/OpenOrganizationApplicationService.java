package com.iwhalecloud.byai.manager.application.service.openapi;

import com.iwhalecloud.byai.manager.domain.organization.service.OrgExternalSystemService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.manager.domain.users.service.UsersOrganizationService;
import com.iwhalecloud.byai.manager.dto.openapi.OpenOrgDTO;
import com.iwhalecloud.byai.manager.entity.organization.OrgExternalSystem;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.common.constants.users.OrgType;
import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-05-31 22:58:43
 * @description TODO
 */
@Service
public class OpenOrganizationApplicationService {

    @Autowired
    private OrganizationService organizationService;

    @Autowired
    private OrgExternalSystemService orgExternalSystemService;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private UsersOrganizationService usersOrganizationService;

    /**
     * 新增组织
     *
     * @param openOrgDTO 入参
     * @return 组织主键
     */
    public Long addOrg(OpenOrgDTO openOrgDTO) {

        // 创建组织
        Organization organization = new Organization();
        // 是否生成新的主键
        if (openOrgDTO.isNewPrimaryKey()) {
            organization.setOrgId(SequenceService.nextVal());
        }
        else {
            organization.setOrgId(openOrgDTO.getOrgId());
        }

        organization.setOrgCode(openOrgDTO.getOrgCode());
        organization.setOrgName(openOrgDTO.getOrgName());
        organization.setOrgType(OrgType.OUT_ORG);
        this.buildOrgInfo(openOrgDTO, organization);
        organizationService.save(organization);

        // 保存扩展表
        OrgExternalSystem orgExternalSystem = new OrgExternalSystem();
        orgExternalSystem.setPoOrgExternalSystemId(SequenceService.nextVal());
        orgExternalSystem.setSourceType(SourceType.LOCAL);
        orgExternalSystem.setUnionId(String.valueOf(openOrgDTO.getOrgId()));
        orgExternalSystem.setSourceDepId(openOrgDTO.getOrgId());
        orgExternalSystem.setSourceParentDepId(openOrgDTO.getParentOrgId());
        orgExternalSystem.setSourceDepCode(openOrgDTO.getOrgCode());
        orgExternalSystem.setSourceDepName(openOrgDTO.getOrgName());
        orgExternalSystem.setOrgId(organization.getOrgId());
        orgExternalSystem.setBindingTime(new Date());
        orgExternalSystemService.save(orgExternalSystem);

        // 把组织共享到缓存
        ShareCacheUtil.setShareOrganization(organization);

        return organization.getOrgId();
    }

    /**
     * 设置组织灰鼠
     *
     * @param openOrgDTO 组织入参
     * @param organization 组织信息
     */
    private void buildOrgInfo(OpenOrgDTO openOrgDTO, Organization organization) {

        Long parentOrgId = openOrgDTO.getParentOrgId();

        List<OrgExternalSystem> parentOrgList = new ArrayList<>(10);

        while (parentOrgId != null) {
            // 查询当前组织的父组织
            OrgExternalSystem parentOrg = orgExternalSystemService.finByDepId(parentOrgId);
            // 没有父组织，退出循环
            if (parentOrg == null) {
                break;
            }

            // 将父组织添加到列表中
            parentOrgList.add(parentOrg);

            // 更新当前组织ID为父组织ID，准备下一次循环
            parentOrgId = parentOrg.getSourceParentDepId();
        }

        // 没有父组织
        if (ListUtil.isEmpty(parentOrgList)) {
            organization.setOrgLevel(0);
            organization.setPathCode("-1." + organization.getOrgId());
            organization.setParentOrgId(-1L);
        }
        else {

            organization.setOrgLevel(parentOrgList.size());
            organization.setParentOrgId(parentOrgList.get(0).getOrgId());

            // 按照顺序排
            Collections.reverse(parentOrgList);

            // 拼接组织路径
            List<Long> pathOrgIds = new ArrayList<>(10);
            pathOrgIds.add(-1L);
            for (OrgExternalSystem orgExternalSystem : parentOrgList) {
                pathOrgIds.add(orgExternalSystem.getOrgId());
            }
            pathOrgIds.add(organization.getOrgId());

            organization.setPathCode(StringUtils.join(pathOrgIds, "."));
        }
    }

    /**
     * 更新组织
     *
     * @param openOrgDTO 入参
     * @return 组织主键
     */
    public Long updateOrg(OpenOrgDTO openOrgDTO) {

        OrgExternalSystem orgExternalSystem = orgExternalSystemService.finByDepId(openOrgDTO.getOrgId());
        orgExternalSystem.setSourceDepName(openOrgDTO.getOrgName());
        orgExternalSystem.setSourceDepCode(openOrgDTO.getOrgCode());
        orgExternalSystemService.update(orgExternalSystem);

        Organization organization = organizationService.findById(orgExternalSystem.getOrgId());
        organization.setOrgName(openOrgDTO.getOrgName());
        organization.setOrgCode(openOrgDTO.getOrgCode());
        organization.setOrgIndex(openOrgDTO.getOrgIndex());
        organization.setUpdateDate(new Date());
        organizationService.update(organization);

        // 把组织共享到缓存
        ShareCacheUtil.setShareOrganization(organization);

        return organization.getOrgId();
    }

    /**
     * 删除组织
     *
     * @param orgId 删除组织标识
     */
    public void delOrg(Long orgId) {

        OrgExternalSystem orgExternalSystem = orgExternalSystemService.finByDepId(orgId);

        orgExternalSystemService.deleteById(orgExternalSystem.getPoOrgExternalSystemId());

        // 删除组织关联的用户信息
        usersOrganizationService.removeByOrgId(orgExternalSystem.getOrgId());

        // 删除关联组织
        organizationService.deleteById(orgExternalSystem.getOrgId());
    }

    /**
     * 查询组织路径信息
     *
     * @param orgId 组织标识
     * @return Map<String, Object>
     */
    public Map<String, Object> qryOrgById(Long orgId) {
        Organization organization = organizationService.findById(orgId);
        if (organization == null) {
            return null;
        }
        Map<String, Object> returnMap = MapParamUtil.objectToMap(organization);
        returnMap.put("pathName", organizationService.buildPathNameByOrgIds(List.of(orgId)));
        return returnMap;
    }
}
