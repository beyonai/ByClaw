package com.iwhalecloud.byai.manager.application.service.openapi;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;
import com.iwhalecloud.byai.common.constants.resource.OwnershipType;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.auth.PrivilegeGrant;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.qo.resource.ResourceQo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.iwhalecloud.byai.common.constants.auth.GrantToObjType;
import com.iwhalecloud.byai.common.constants.auth.GrantType;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;

/**
 * @author he.duming
 * @date 2025-09-01 23:20:44
 * @description TODO
 */
@Service
public class OpenResourceApplicationService {

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private SsResourceService ssResourceService;

    /**
     * 获取用户授权资源
     *
     * @param resourceQo 查询对象
     * @return ResponseUtil
     */
    public PageInfo<SsResource> getUserAuthResource(ResourceQo resourceQo) {

        Long userId = CurrentUserHolder.getCurrentUserId();
        List<String> resourceBizTypes = this.rebuildResourceBizTypes(resourceQo.getResourceBizTypes());

        if (OwnershipType.OWNER_CREATE.getNum().equals(resourceQo.getOwnershipType())) {
            resourceQo.setResourceBizTypes(resourceBizTypes);
            resourceQo.setCreateBy(userId);
            return ssResourceService.selectResourceByQo(resourceQo);
        }
        else {

            List<String> grantTypes = List.of(GrantType.AVAILABLE_USE, GrantType.FORCE_USE, GrantType.SHARE_USE);
            List<PrivilegeGrant> privilegeGrants = authApplicationService.listAuthPrivilegeGrant(null, resourceBizTypes,
                GrantToObjType.USER, userId, grantTypes);

            // 查询授权资源标识
            List<Long> resourceIds = new ArrayList<>(10);
            for (PrivilegeGrant privilegeGrant : privilegeGrants) {
                resourceIds.add(privilegeGrant.getGrantObjId());
            }

            if (ListUtil.isEmpty(resourceIds)) {
                return PageHelperUtil.emptyPage(resourceQo.getPageNum(), resourceQo.getPageSize());
            }

            // 添加资源标识过滤
            resourceQo.setResourceIds(resourceIds);
            resourceQo.setResourceBizTypes(resourceBizTypes);
            return ssResourceService.selectResourceByQo(resourceQo);
        }
    }

    /**
     * 扩展授权知识库类�?如果是Doc的增�?KG_DOC|KG_TERM|KG_QA
     *
     * @param resourceBizTypes 授权资源类型
     * @return List
     */
    private List<String> rebuildResourceBizTypes(List<String> resourceBizTypes) {

        List<String> grantObjTypes = new ArrayList<>(10);

        if (ListUtil.isEmpty(resourceBizTypes)) {
            return Collections.emptyList();
        }

        for (String resourceBizType : resourceBizTypes) {
            // 如果是DOC,把所有类型的知识库都添加进来
            if ("DOC".equalsIgnoreCase(resourceBizType)) {
                grantObjTypes.add(ResourceBizType.KG_DOC.getCode());
                grantObjTypes.add(ResourceBizType.KG_TERM.getCode());
                grantObjTypes.add(ResourceBizType.KG_QA.getCode());
            }
            else {
                grantObjTypes.add(resourceBizType);
            }
        }
        return grantObjTypes;
    }

}
