package com.iwhalecloud.byai.manager.application.service.ontology;

import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.request.ResourceUseAuthQo;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceAuthApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceRelDetailService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBaseQueryRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBindNode;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyBindRequest;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceRelDetail;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.vo.auth.ResourceAuthVo;
import com.iwhalecloud.byai.common.page.PageInfo;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 本体绑定服务：把某本体库下选中的节点(叶子集合)以「覆盖式(多退少补)」绑定到数字员工。
 *
 * <p>动作：①按选中叶子路径 upsert 虚拟资源(SCENE/VIEW/OBJECT + ss_res_ext_ontology.pid=本体库编码 + 重建元数据)；
 * ②按本体库作用域覆盖数字员工关系明细(去掉本库旧的 ontology 资源 + 加入新叶子)，复用 DE 的关系同步；
 * ③迭代孤儿清理：本库中不再被任何关系引用、且无本体子节点的虚拟资源(SCENE/VIEW/OBJECT)删除。
 * relOntology / relResourceList.ontologyBaseCode 由详情侧从这些资源与 ext 元数据重建，本服务只负责资源与关系。
 *
 * @author qin.guoquan
 * @date 2026-07-04 14:38:38
 */
@Service
public class OntologyBindService {

    private static final Logger logger = LoggerFactory.getLogger(OntologyBindService.class);

    private static final String LEVEL_BASE = "BASE";
    private static final String LEVEL_SCENE = "SCENE";
    private static final String LEVEL_VIEW = "VIEW";
    private static final String LEVEL_OBJECT_IN_SCENE = "OBJECT_IN_SCENE";
    private static final String LEVEL_OBJECT_IN_VIEW = "OBJECT_IN_VIEW";

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
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResourceRelDetailService ssResourceRelDetailService;

    @Autowired
    private DigitalEmployeeApplicationService digitalEmployeeApplicationService;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private ResourceAuthApplicationService resourceAuthApplicationService;

    /**
     * 覆盖式绑定：以本次选中为准，重写该本体库在此数字员工下的绑定。
     */
    @Transactional(rollbackFor = Exception.class)
    public void bindOntology(OntologyBindRequest req) {
        if (req == null || req.getDigitalEmployeeId() == null || StringUtils.isBlank(req.getBaseId())) {
            throw new BaseException("绑定参数不完整：digitalEmployeeId / baseId 不能为空");
        }
        Long digitalEmployeeId = req.getDigitalEmployeeId();
        String baseId = req.getBaseId();

        // 本库已有资源(含本体库本身及此前虚拟出的 场景/视图/对象)，按 bizType|code 建索引
        List<SsResource> baseResources = resourcesOfBase(baseId);
        SsResource baseRes = baseResources.stream()
            .filter(r -> BIZ_BASE.equals(r.getResourceBizType()) && baseId.equals(r.getResourceCode())).findFirst()
            .orElse(null);
        if (baseRes == null) {
            throw new BaseException("本体库资源不存在，请先注册或刷新本体库");
        }
        validateBindPermission(digitalEmployeeId, baseRes);
        String ownerType = baseRes.getOwnerType();
        Map<String, SsResource> byKey = new HashMap<>();
        for (SsResource r : baseResources) {
            byKey.put(r.getResourceBizType() + "|" + r.getResourceCode(), r);
        }

        // 1. 逐个选中叶子：沿路径 upsert 虚拟资源，收集叶子资源 id
        Set<Long> leafIds = new LinkedHashSet<>();
        List<OntologyBindNode> nodes = req.getNodes() == null ? new ArrayList<>() : req.getNodes();
        if (nodes.isEmpty() && !Boolean.TRUE.equals(req.getConfirmClear())) {
            throw new BaseException("当前本体资源树选中节点数为0，请确认清空操作后再保存");
        }
        for (OntologyBindNode node : nodes) {
            String level = StringUtils.defaultString(node.getLevel());
            switch (level) {
                case LEVEL_BASE:
                    leafIds.add(baseRes.getResourceId());
                    break;
                case LEVEL_SCENE:
                    leafIds.add(ensureScene(node, baseRes, byKey, baseId, ownerType).getResourceId());
                    break;
                case LEVEL_VIEW: {
                    SsResource scene = ensureScene(node, baseRes, byKey, baseId, ownerType);
                    leafIds.add(ensureView(node, scene, byKey, baseId, ownerType).getResourceId());
                    break;
                }
                case LEVEL_OBJECT_IN_SCENE: {
                    SsResource scene = ensureScene(node, baseRes, byKey, baseId, ownerType);
                    leafIds.add(ensureObject(node, scene, false, byKey, baseId, ownerType).getResourceId());
                    break;
                }
                case LEVEL_OBJECT_IN_VIEW: {
                    SsResource scene = ensureScene(node, baseRes, byKey, baseId, ownerType);
                    SsResource view = ensureView(node, scene, byKey, baseId, ownerType);
                    leafIds.add(ensureObject(node, view, true, byKey, baseId, ownerType).getResourceId());
                    break;
                }
                default:
                    logger.warn("ontology bind: unknown node level={}, skipped", level);
            }
        }

        // 2. 计算目标全量 relIds = 现有关系去掉本库 ontology 资源 + 新选中叶子
        List<SsResourceRelDetail> existingDetails = ssResourceRelDetailService.findByResourceId(digitalEmployeeId);
        Set<Long> baseResourceIds = baseResources.stream().map(SsResource::getResourceId).collect(Collectors.toSet());
        LinkedHashSet<Long> targetRelIds = new LinkedHashSet<>();
        for (SsResourceRelDetail d : existingDetails) {
            Long relId = d.getRelResourceId();
            if (relId != null && !baseResourceIds.contains(relId)) {
                targetRelIds.add(relId);
            }
        }
        targetRelIds.addAll(leafIds);

        // 3. 覆盖式同步关系明细 + 运行期重同步(relIds/relResourceList/targetContent 随之刷新)
        digitalEmployeeApplicationService.syncRelResourcesByTargetIds(digitalEmployeeId, new ArrayList<>(targetRelIds));

        // 4. 迭代孤儿清理：本库中不再被任何关系引用、且无本体子节点的 场景/视图/对象
        cleanupOrphanResources(baseId);
    }

    /**
     * 数字员工配置页可绑定的本体库候选列表。
     *
     * <p>这里不能走本体中心“企业全量可申请”口径，只返回当前用户已具备使用/管理权限或自己创建的本体库。
     */
    public PageInfo<ResourceAuthVo> candidateBases(OntologyBaseQueryRequest req) {
        ResourceUseAuthQo qo = new ResourceUseAuthQo();
        qo.setOwnerType(StringUtils.defaultIfBlank(req == null ? null : req.getOwnerType(), "personal"));
        qo.setKeyword(req == null ? null : req.getQueryKeyword());
        qo.setPageNum(1);
        qo.setPageSize(200);
        qo.setResourceBizTypeList(List.of(BIZ_BASE));
        return resourceAuthApplicationService.listResourceAuth(qo);
    }

    /**
     * 查询某数字员工「已绑定」的本体库列表：从其关联资源里挑出本体类叶子(SCENE/VIEW/OBJECT/ONTOLOGY_BASE)，
     * 取各自 ontologyBaseCode(ss_res_ext_ontology.pid)去重，反查对应的 ONTOLOGY_BASE 资源返回。
     * 仅绑定了场景/对象(未绑库级)时，库级本身不在关系里，故必须经此反查，不能直接过滤 ONTOLOGY_BASE 关系。
     */
    public List<SsResource> boundBases(Long digitalEmployeeId) {
        if (digitalEmployeeId == null) {
            return new ArrayList<>();
        }
        List<SsResourceRelDetail> rels = ssResourceRelDetailService.findByResourceId(digitalEmployeeId);
        List<Long> relIds = rels.stream().map(SsResourceRelDetail::getRelResourceId).filter(java.util.Objects::nonNull)
            .distinct().collect(Collectors.toList());
        if (relIds.isEmpty()) {
            return new ArrayList<>();
        }
        List<SsResource> resources = ssResourceMapper.selectBatchIds(relIds);
        List<SsResource> ontologyResources = resources == null ? new ArrayList<>()
            : resources.stream().filter(r -> isOntologyBiz(r.getResourceBizType())).collect(Collectors.toList());
        if (ontologyResources.isEmpty()) {
            return new ArrayList<>();
        }
        Set<String> baseCodes = new java.util.HashSet<>();
        // ONTOLOGY_BASE 资源：resourceCode 即本体库编码，直接用（不依赖 ext）
        ontologyResources.stream().filter(r -> BIZ_BASE.equals(r.getResourceBizType()))
            .map(SsResource::getResourceCode).filter(StringUtils::isNotBlank).forEach(baseCodes::add);
        // 场景/视图/对象：本体库编码取自 ss_res_ext_ontology.pid
        List<Long> ontologyIds = ontologyResources.stream().map(SsResource::getResourceId).collect(Collectors.toList());
        List<SsResExtOntology> exts = ssResExtOntologyMapper.selectByResourceIds(ontologyIds);
        if (exts != null) {
            exts.stream().map(SsResExtOntology::getPid).filter(StringUtils::isNotBlank).forEach(baseCodes::add);
        }
        if (baseCodes.isEmpty()) {
            return new ArrayList<>();
        }
        LambdaQueryWrapper<SsResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResource::getResourceBizType, BIZ_BASE);
        wrapper.in(SsResource::getResourceCode, baseCodes);
        List<SsResource> bases = ssResourceMapper.selectList(wrapper);
        return bases == null ? new ArrayList<>() : bases;
    }

    private boolean isOntologyBiz(String biz) {
        return BIZ_BASE.equals(biz) || BIZ_SCENE.equals(biz) || BIZ_VIEW.equals(biz) || BIZ_OBJECT.equals(biz);
    }

    private void validateBindPermission(Long digitalEmployeeId, SsResource baseRes) {
        SsResource digitalEmployee = ssResourceService.findById(digitalEmployeeId);
        if (digitalEmployee == null || !BIZ_DIG_EMPLOYEE.equals(digitalEmployee.getResourceBizType())) {
            throw new BaseException("数字员工资源不存在或类型不正确");
        }
        if (!authApplicationService.hasResourceManagePermission(digitalEmployee)) {
            throw new BaseException("当前用户对数字员工【" + digitalEmployee.getResourceName() + "】没有管理权限，无法绑定本体");
        }
        boolean hasBasePermission = authApplicationService.hasResourceManagePermission(baseRes)
            || authApplicationService.hasResourceUsePermission(baseRes);
        if (!hasBasePermission) {
            throw new BaseException("当前用户对本体库【" + baseRes.getResourceName() + "】没有使用或管理权限，无法绑定本体");
        }
    }

    /** 本体库下全部资源(经 ss_res_ext_ontology.pid 过滤)。 */
    private List<SsResource> resourcesOfBase(String baseId) {
        List<SsResExtOntology> exts = ssResExtOntologyMapper.selectByPid(baseId);
        if (exts == null || exts.isEmpty()) {
            return new ArrayList<>();
        }
        List<Long> ids = exts.stream().map(SsResExtOntology::getResourceId).collect(Collectors.toList());
        List<SsResource> rows = ssResourceMapper.selectBatchIds(ids);
        return rows == null ? new ArrayList<>() : rows;
    }

    private SsResource ensureScene(OntologyBindNode node, SsResource baseRes, Map<String, SsResource> byKey,
        String baseId, String ownerType) {
        return upsert(BIZ_SCENE, node.getSceneId(), StringUtils.defaultIfBlank(node.getSceneName(), node.getSceneId()),
            node.getSceneDesc(), baseRes.getResourceId(), byKey, baseId, ownerType, sceneMeta(node, baseId));
    }

    private SsResource ensureView(OntologyBindNode node, SsResource scene, Map<String, SsResource> byKey, String baseId,
        String ownerType) {
        return upsert(BIZ_VIEW, node.getViewCode(), StringUtils.defaultIfBlank(node.getViewName(), node.getViewCode()),
            node.getViewDesc(), scene.getResourceId(), byKey, baseId, ownerType, viewMeta(node, baseId));
    }

    private SsResource ensureObject(OntologyBindNode node, SsResource parent, boolean underView,
        Map<String, SsResource> byKey, String baseId, String ownerType) {
        return upsert(BIZ_OBJECT, node.getObjectCode(),
            StringUtils.defaultIfBlank(node.getObjectName(), node.getObjectCode()), node.getObjectDesc(),
            parent.getResourceId(), byKey, baseId, ownerType, objectMeta(node, baseId, underView));
    }

    /** upsert 虚拟资源：已存复用；不存用 saveResource 建 + 写 ext(pid + 重建元数据)。 */
    private SsResource upsert(String bizType, String code, String name, String desc, Long parentId,
        Map<String, SsResource> byKey, String baseId, String ownerType, String metaJson) {
        String key = bizType + "|" + code;
        SsResource existing = byKey.get(key);
        if (existing != null) {
            return existing;
        }
        SsResource res = new SsResource();
        res.setResourceBizType(bizType);
        res.setResourceName(name);
        res.setResourceCode(code);
        res.setResourceDesc(desc);
        res.setParentResourceId(parentId);
        res.setOwnerType(ownerType);
        SsResource saved = ssResourceService.saveResource(res);

        SsResExtOntology ext = new SsResExtOntology();
        ext.setResourceId(saved.getResourceId());
        ext.setPid(baseId);
        ext.setTargetContent(metaJson);
        ssResExtOntologyMapper.insert(ext);

        byKey.put(key, saved);
        return saved;
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
                ssResExtOntologyMapper.deleteByResourceId(r.getResourceId());
                ssResourceMapper.deleteById(r.getResourceId());
                changed = true;
            }
        }
    }

    private boolean hasChild(Long parentId) {
        LambdaQueryWrapper<SsResource> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(SsResource::getParentResourceId, parentId);
        return ssResourceMapper.selectCount(wrapper) > 0;
    }

    private String sceneMeta(OntologyBindNode node, String baseId) {
        JSONObject m = new JSONObject();
        m.put("ontologyBaseCode", baseId);
        m.put("sceneId", node.getSceneId());
        m.put("sceneName", node.getSceneName());
        return JSON.toJSONString(m);
    }

    private String viewMeta(OntologyBindNode node, String baseId) {
        JSONObject m = new JSONObject();
        m.put("ontologyBaseCode", baseId);
        m.put("sceneId", node.getSceneId());
        m.put("sceneName", node.getSceneName());
        m.put("viewCode", node.getViewCode());
        m.put("viewName", node.getViewName());
        return JSON.toJSONString(m);
    }

    private String objectMeta(OntologyBindNode node, String baseId, boolean underView) {
        JSONObject m = new JSONObject();
        m.put("ontologyBaseCode", baseId);
        m.put("sceneId", node.getSceneId());
        m.put("sceneName", node.getSceneName());
        if (underView) {
            m.put("viewCode", node.getViewCode());
            m.put("viewName", node.getViewName());
        }
        m.put("objectCode", node.getObjectCode());
        m.put("objectName", node.getObjectName());
        return JSON.toJSONString(m);
    }
}
