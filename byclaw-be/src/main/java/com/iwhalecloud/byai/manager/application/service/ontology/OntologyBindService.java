package com.iwhalecloud.byai.manager.application.service.ontology;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSceneMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 本体资源与数字员工关系辅助服务。
 *
 * @author qin.guoquan
 * @date 2026-07-04 14:38:38
 */
@Service
public class OntologyBindService {

    private static final String BIZ_BASE = ResourceBizType.ONTOLOGY_BASE.getCode();
    private static final String BIZ_DIG_EMPLOYEE = ResourceBizType.DIG_EMPLOYEE.getCode();
    private static final String BIZ_SCENE = ResourceBizType.SCENE.getCode();
    private static final String BIZ_VIEW = ResourceBizType.VIEW.getCode();
    private static final String BIZ_OBJECT = ResourceBizType.OBJECT.getCode();

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private SsResExtSceneMapper ssResExtSceneMapper;

    @Autowired
    private SsResExtViewMapper ssResExtViewMapper;

    @Autowired
    private SsResExtObjectMapper ssResExtObjectMapper;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private AuthApplicationService authApplicationService;

    /**
     * 单节点解绑：解除某本体资源(视图/对象/场景/库)与数字员工的绑定关系。
     *
     * <p>覆盖式重算目标关系(仅移除该资源)，复用 DE 关系同步刷新 relIds/relResourceList/targetContent，
     * 再对该资源所属本体库做一次孤儿清理。父级(场景/库)不会被动跟着解绑，仅在其变孤儿时被清理。
     */
    @Transactional(rollbackFor = Exception.class)
    public void unbindResource(Long digitalEmployeeId, Long relResourceId) {
        if (digitalEmployeeId == null || relResourceId == null) {
            throw new BaseException("解绑参数不完整：digitalEmployeeId / relResourceId 不能为空");
        }
        SsResource digitalEmployee = ssResourceService.findById(digitalEmployeeId);
        if (digitalEmployee == null || !BIZ_DIG_EMPLOYEE.equals(digitalEmployee.getResourceBizType())) {
            throw new BaseException("数字员工资源不存在或类型不正确");
        }
        if (!authApplicationService.hasResourceManagePermission(digitalEmployee)) {
            throw new BaseException("当前用户对数字员工【" + digitalEmployee.getResourceName() + "】没有管理权限，无法解绑本体");
        }

        List<SsResourceRelDetail> existingDetails = ssResourceRelDetailService.findByResourceId(digitalEmployeeId);
        LinkedHashSet<Long> targetRelIds = new LinkedHashSet<>();
        boolean matched = false;
        for (SsResourceRelDetail d : existingDetails) {
            Long relId = d.getRelResourceId();
            if (relId == null) {
                continue;
            }
            if (relId.equals(relResourceId)) {
                matched = true;
                continue;
            }
            targetRelIds.add(relId);
        }
        if (!matched) {
            return;
        }
        digitalEmployeeApplicationService.syncRelResourcesByTargetIds(digitalEmployeeId, new ArrayList<>(targetRelIds));

        SsResource relResource = ssResourceService.findById(relResourceId);
        if (relResource != null && isOntologyBiz(relResource.getResourceBizType())) {
            String baseId = resolveBaseCode(relResource);
            if (StringUtils.isNotBlank(baseId)) {
                cleanupOrphanResources(baseId);
            }
        }
    }

    /** 取某本体资源所属的本体库编码：库级用 resourceCode，其它经扩展表反查。 */
    private String resolveBaseCode(SsResource res) {
        if (res == null) {
            return null;
        }
        if (BIZ_BASE.equals(res.getResourceBizType())) {
            return res.getResourceCode();
        }
        return ssResourceService.findOntologyBaseCodeMap(List.of(res.getResourceId())).get(res.getResourceId());
    }

    private boolean isOntologyBiz(String biz) {
        return BIZ_BASE.equals(biz) || BIZ_SCENE.equals(biz) || BIZ_VIEW.equals(biz) || BIZ_OBJECT.equals(biz);
    }

    /** 本体库下全部资源(经各自扩展表过滤)。 */
    private List<SsResource> resourcesOfBase(String baseId) {
        List<Long> ids = ssResourceService.findOntologyResourceIdsByBaseCode(baseId);
        if (ids.isEmpty()) {
            return new ArrayList<>();
        }
        List<SsResource> rows = ssResourceMapper.selectBatchIds(ids);
        return rows == null ? new ArrayList<>() : rows;
    }

    /**
     * 迭代自底向上清理孤儿：某 场景/视图/对象 资源若「无任何关系引用」且「无本体子节点」，则删除(资源 + ext)。
     * 删完可能让其父变成孤儿，故循环直到稳定；跨所有数字员工判断引用，避免误删共享绑定。
     */
    private void cleanupOrphanResources(String baseId) {
        boolean changed = true;
        while (changed) {
            changed = false;
            List<SsResource> rows = resourcesOfBase(baseId);
            for (SsResource r : rows) {
                String biz = r.getResourceBizType();
                if (!BIZ_SCENE.equals(biz) && !BIZ_VIEW.equals(biz) && !BIZ_OBJECT.equals(biz)) {
                    continue;
                }
                if (ssResourceRelDetailService.countByRelResourceId(r.getResourceId()) > 0) {
                    continue;
                }
                if (hasChild(r.getResourceId())) {
                    continue;
                }
                deleteExtByBizType(r);
                ssResourceMapper.deleteById(r.getResourceId());
                changed = true;
            }
        }
    }

    private void deleteExtByBizType(SsResource resource) {
        if (resource == null || resource.getResourceId() == null) {
            return;
        }
        if (BIZ_SCENE.equals(resource.getResourceBizType())) {
            ssResExtSceneMapper.deleteById(resource.getResourceId());
        }
        else if (BIZ_VIEW.equals(resource.getResourceBizType())) {
            ssResExtViewMapper.deleteById(resource.getResourceId());
        }
        else if (BIZ_OBJECT.equals(resource.getResourceBizType())) {
            ssResExtObjectMapper.deleteById(resource.getResourceId());
        }
    }

    private boolean hasChild(Long parentId) {
        LambdaQueryWrapper<SsResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResource::getParentResourceId, parentId);
        return ssResourceMapper.selectCount(wrapper) > 0;
    }

}
