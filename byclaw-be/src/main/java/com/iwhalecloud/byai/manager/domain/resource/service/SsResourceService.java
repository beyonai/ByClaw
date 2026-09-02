package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.alibaba.fastjson.JSON;
import com.alibaba.fastjson.JSONObject;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.constants.resource.ImplType;
import com.iwhalecloud.byai.common.constants.resource.OwnerType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.entity.ontology.SsResExtOntology;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtObject;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtScene;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtView;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.ontology.SsResExtOntologyMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtObjectMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtSceneMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtViewMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.StringUtil;

import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.HashSet;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;

import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.qo.resource.ResourceQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.resource.qo.DatasetQo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetVo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-09-02 17:51:37
 * @description 资源主表（ss_resource）领域服务：CRUD、分页查询、关联与文档库/数字员工扩展查询
 */
@Service
public class SsResourceService {

    /**
     * 序列服务，用于生成 {@link SsResource#getResourceId()}
     */
    @Autowired
    private SequenceService sequenceService;

    /**
     * 资源主表 Mapper
     */
    @Autowired
    private SsResourceMapper ssResourceMapper;

    /**
     * 数字员工扩展表 Mapper
     */
    @Autowired
    private SsResExtDigEmployeeMapper ssResExtDigEmployeeMapper;

    /**
     * 本体资源扩展表 Mapper
     */
    @Autowired
    private SsResExtOntologyMapper ssResExtOntologyMapper;

    @Autowired
    private SsResExtSceneMapper ssResExtSceneMapper;

    @Autowired
    private SsResExtViewMapper ssResExtViewMapper;

    @Autowired
    private SsResExtObjectMapper ssResExtObjectMapper;

    /**
     * 按条件分页查询文档库（数据集）列表
     *
     * @param datasetQo 分页与筛选条件
     * @return 分页结果
     */
    public PageInfo<DatasetVo> selectDatasetByQo(DatasetQo datasetQo) {

        int pn = datasetQo.getPageNum() > 0 ? datasetQo.getPageNum() : 1;
        int ps = datasetQo.getPageSize() > 0 ? datasetQo.getPageSize() : 10;

        Page<DatasetVo> page = PageHelper.startPage(pn, ps);
        ssResourceMapper.selectDatasetByQo(datasetQo);
        return PageHelperUtil.toPageInfo(page);
    }

    /**
     * 保存资源
     *
     * @param ssResource 资源
     */
    public void save(SsResource ssResource) {
        ssResource.setImplType(ssResource.getImplType());
        ssResource.setWorkerAgentType(ssResource.getWorkerAgentType());
        assertResourceCodeAvailableForCreate(ssResource);
        ssResourceMapper.insert(ssResource);
    }

    /**
     * 更新资源
     *
     * @param ssResource 资源
     */
    public void update(SsResource ssResource) {
        ssResource.setImplType(ssResource.getImplType());
        ssResource.setWorkerAgentType(ssResource.getWorkerAgentType());
        ssResourceMapper.updateById(ssResource);
    }

    /**
     * 保存资源主表记录，并统一补齐新增场景的默认字段。
     *
     * @author qin.guoquan
     * @date 2026-04-26 12:05:00
     */
    public SsResource saveResource(SsResource ssResource) {
        fillCreateDefaults(ssResource);
        assertResourceCodeAvailableForCreate(ssResource);
        ssResourceMapper.insert(ssResource);
        return ssResource;
    }

    /**
     * 更新资源主表记录，并统一补齐更新场景的审计字段。
     *
     * @author qin.guoquan
     * @date 2026-04-26 12:05:00
     */
    public SsResource updateResourceEntity(SsResource ssResource) {
        fillUpdateDefaults(ssResource);
        ssResourceMapper.updateById(ssResource);
        return ssResource;
    }

    /**
     * 将草稿/正式发布版本号字段置空（仅维护 resourceVersionId 场景）
     *
     * @param resourceId 资源主键
     */
    public void clearResourceDraftAndReleaseVerIds(Long resourceId) {
        if (resourceId == null) {
            return;
        }
        LambdaUpdateWrapper<SsResource> w = new LambdaUpdateWrapper<>();
        w.eq(SsResource::getResourceId, resourceId).set(SsResource::getResourceDVerid, null)
            .set(SsResource::getResourceRVerid, null);
        ssResourceMapper.update(null, w);
    }

    /**
     * 移除资源
     *
     * @param resourceId 资源
     */
    public void removeById(Long resourceId) {
        ssResourceMapper.deleteById(resourceId);
    }

    /**
     * 按主键查询资源
     *
     * @param resourceId 资源标识
     * @return 实体，主键为空或不存在时返回 null
     */
    public SsResource findById(Long resourceId) {

        if (resourceId == null) {
            return null;
        }

        return ssResourceMapper.selectById(resourceId);
    }

    /**
     * 按主键或资源编码查询（可只传其一）
     *
     * @param resourceId   资源主键，可空
     * @param resourceCode 资源编码，可空
     * @return 单条记录，无匹配时可能为 null
     */
    public SsResource findByIdOrCode(Long resourceId, String resourceCode) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        if (resourceId != null) {
            queryWrapper.eq(SsResource::getResourceId, resourceId);
        }
        if (StringUtil.isNotEmpty(resourceCode)) {
            queryWrapper.eq(SsResource::getResourceCode, resourceCode);
        }
        return ssResourceMapper.selectOne(queryWrapper, false);
    }

    /**
     * 按资源编码查询资源。
     *
     * @param resourceCode 资源编码
     * @return 匹配资源列表
     */
    public List<SsResource> findByCode(String resourceCode) {
        if (StringUtil.isEmpty(resourceCode)) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceCode, resourceCode);
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 根据编码批量查找资源
     *
     * @param resourceCodes 资源编码
     * @return List<SsResource>
     */
    public List<SsResource> findByResourceCode(List<String> resourceCodes) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResource::getResourceCode, resourceCodes);
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 按 systemCode + resourceBizType + resourceCode 查询唯一资源。
     */
    public SsResource findUniqueBySystemCodeAndBizTypeAndResourceCode(String systemCode, String resourceBizType,
                                                                      String resourceCode) {
        if (StringUtil.isEmpty(systemCode) || StringUtil.isEmpty(resourceBizType) || StringUtil.isEmpty(resourceCode)) {
            return null;
        }
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getSystemCode, systemCode);
        queryWrapper.eq(SsResource::getResourceBizType, resourceBizType);
        queryWrapper.eq(SsResource::getResourceCode, resourceCode);
        List<SsResource> resources = ssResourceMapper.selectList(queryWrapper);
        if (ListUtil.isEmpty(resources)) {
            return null;
        }
        if (resources.size() > 1) {
            throw new BaseException("资源自然键不唯一：" + systemCode + "/" + resourceBizType + "/" + resourceCode);
        }
        return resources.get(0);
    }

    /**
     * 新增资源前校验 systemCode + resourceBizType + resourceCode 未被占用。更新已有资源请走 updateResourceEntity。
     */
    private void assertResourceCodeAvailableForCreate(SsResource ssResource) {
        if (ssResource == null || StringUtil.isEmpty(ssResource.getSystemCode())
            || StringUtil.isEmpty(ssResource.getResourceBizType()) || StringUtil.isEmpty(ssResource.getResourceCode())) {
            return;
        }
        SsResource existing = findUniqueBySystemCodeAndBizTypeAndResourceCode(ssResource.getSystemCode(),
            ssResource.getResourceBizType(), ssResource.getResourceCode());
        if (existing != null) {
            throw new BaseException("资源已存在：" + ssResource.getSystemCode() + "/" + ssResource.getResourceBizType()
                + "/" + ssResource.getResourceCode());
        }
    }

    /**
     * 按资源编码和资源类型查询资源。
     *
     * @param resourceCode    资源编码
     * @param resourceBizType 资源业务类型
     * @return 匹配资源列表
     */
    public List<SsResource> findByCodeAndBizType(String resourceCode, String resourceBizType) {
        if (StringUtil.isEmpty(resourceCode) || StringUtil.isEmpty(resourceBizType)) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceCode, resourceCode);
        queryWrapper.eq(SsResource::getResourceBizType, resourceBizType);
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 按资源编码、资源类型、本体库编码查询资源。
     *
     * <p>本体类子资源（SCENE/VIEW/OBJECT）的编码只在所属本体库内唯一，调用方应传
     * ontologyBaseCode，经各自扩展表 target_content.ontologyBaseCode 缩小范围后再匹配 ss_resource。
     * 本体子资源不允许跨库按编码模糊命中，ontologyBaseCode 为空时直接返回空列表。
     *
     * @param resourceCode     资源编码
     * @param resourceBizType  资源业务类型
     * @param ontologyBaseCode 所属本体库编码，本体子资源必填
     * @return 匹配资源列表
     */
    public List<SsResource> findByCodeAndBizTypeAndOntologyBaseCode(String resourceCode, String resourceBizType,
                                                                    String ontologyBaseCode) {
        if (StringUtil.isEmpty(resourceCode) || StringUtil.isEmpty(resourceBizType)) {
            return Collections.emptyList();
        }
        boolean ontologyChildBizType = "SCENE".equals(resourceBizType) || "VIEW".equals(resourceBizType)
            || "OBJECT".equals(resourceBizType);
        if (ontologyChildBizType && StringUtils.isBlank(ontologyBaseCode)) {
            return Collections.emptyList();
        }

        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceCode, resourceCode);
        queryWrapper.eq(SsResource::getResourceBizType, resourceBizType);

        if (StringUtils.isNotBlank(ontologyBaseCode)) {
            List<Long> resourceIds = findOntologyResourceIdsByBaseCode(ontologyBaseCode);
            if (ListUtil.isEmpty(resourceIds)) {
                return Collections.emptyList();
            }
            queryWrapper.in(SsResource::getResourceId, resourceIds);
        }

        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 查询本体库下所有资源ID：本体库自身走 ss_res_ext_ontology.pid，
     * 场景/视图/对象分别走各自扩展表 target_content 中的 ontologyBaseCode。
     */
    public List<Long> findOntologyResourceIdsByBaseCode(String ontologyBaseCode) {
        if (StringUtils.isBlank(ontologyBaseCode)) {
            return Collections.emptyList();
        }
        Set<Long> ids = new HashSet<>();
        List<SsResExtOntology> ontologyExts = ssResExtOntologyMapper.selectByPid(ontologyBaseCode);
        if (ListUtil.isNotEmpty(ontologyExts)) {
            ids.addAll(ontologyExts.stream().map(SsResExtOntology::getResourceId).collect(Collectors.toSet()));
        }
        String baseCodePattern = ontologyBaseCodePattern(ontologyBaseCode);
        LambdaQueryWrapper<SsResExtScene> sceneWrapper = new LambdaQueryWrapper<>();
        sceneWrapper.like(SsResExtScene::getTargetContent, baseCodePattern);
        List<SsResExtScene> sceneExts = ssResExtSceneMapper.selectList(sceneWrapper);
        if (ListUtil.isNotEmpty(sceneExts)) {
            ids.addAll(sceneExts.stream().map(SsResExtScene::getResourceId).collect(Collectors.toSet()));
        }
        LambdaQueryWrapper<SsResExtView> viewWrapper = new LambdaQueryWrapper<>();
        viewWrapper.like(SsResExtView::getTargetContent, baseCodePattern);
        List<SsResExtView> viewExts = ssResExtViewMapper.selectList(viewWrapper);
        if (ListUtil.isNotEmpty(viewExts)) {
            ids.addAll(viewExts.stream().map(SsResExtView::getResourceId).collect(Collectors.toSet()));
        }
        LambdaQueryWrapper<SsResExtObject> objectWrapper = new LambdaQueryWrapper<>();
        objectWrapper.like(SsResExtObject::getTargetContent, baseCodePattern);
        List<SsResExtObject> objectExts = ssResExtObjectMapper.selectList(objectWrapper);
        if (ListUtil.isNotEmpty(objectExts)) {
            ids.addAll(objectExts.stream().map(SsResExtObject::getResourceId).collect(Collectors.toSet()));
        }
        return ids.stream().collect(Collectors.toList());
    }

    /**
     * 查询本体类资源ID对应的本体库编码。
     */
    public Map<Long, String> findOntologyBaseCodeMap(Collection<Long> resourceIds) {
        Map<Long, String> result = new HashMap<>();
        if (ListUtil.isEmpty(resourceIds)) {
            return result;
        }
        List<SsResExtOntology> ontologyExts = ssResExtOntologyMapper.selectByResourceIds(resourceIds);
        if (ListUtil.isNotEmpty(ontologyExts)) {
            for (SsResExtOntology ext : ontologyExts) {
                if (ext != null && ext.getResourceId() != null && StringUtils.isNotBlank(ext.getPid())) {
                    result.put(ext.getResourceId(), ext.getPid());
                }
            }
        }
        LambdaQueryWrapper<SsResExtScene> sceneWrapper = new LambdaQueryWrapper<>();
        sceneWrapper.in(SsResExtScene::getResourceId, resourceIds);
        List<SsResExtScene> sceneExts = ssResExtSceneMapper.selectList(sceneWrapper);
        if (ListUtil.isNotEmpty(sceneExts)) {
            for (SsResExtScene ext : sceneExts) {
                putOntologyBaseCode(result, ext.getResourceId(), ext.getTargetContent());
            }
        }
        LambdaQueryWrapper<SsResExtView> viewWrapper = new LambdaQueryWrapper<>();
        viewWrapper.in(SsResExtView::getResourceId, resourceIds);
        List<SsResExtView> viewExts = ssResExtViewMapper.selectList(viewWrapper);
        if (ListUtil.isNotEmpty(viewExts)) {
            for (SsResExtView ext : viewExts) {
                putOntologyBaseCode(result, ext.getResourceId(), ext.getTargetContent());
            }
        }
        LambdaQueryWrapper<SsResExtObject> objectWrapper = new LambdaQueryWrapper<>();
        objectWrapper.in(SsResExtObject::getResourceId, resourceIds);
        List<SsResExtObject> objectExts = ssResExtObjectMapper.selectList(objectWrapper);
        if (ListUtil.isNotEmpty(objectExts)) {
            for (SsResExtObject ext : objectExts) {
                putOntologyBaseCode(result, ext.getResourceId(), ext.getTargetContent());
            }
        }
        return result;
    }

    private void putOntologyBaseCode(Map<Long, String> target, Long resourceId, String targetContent) {
        if (resourceId == null || StringUtils.isBlank(targetContent)) {
            return;
        }
        try {
            JSONObject json = JSON.parseObject(targetContent);
            String ontologyBaseCode = json.getString("ontologyBaseCode");
            if (StringUtils.isNotBlank(ontologyBaseCode)) {
                target.put(resourceId, ontologyBaseCode);
            }
        } catch (Exception ignored) {
            // 历史脏数据不影响主查询，缺失时由调用方按资源树兜底。
        }
    }

    private String ontologyBaseCodePattern(String ontologyBaseCode) {
        return "\"ontologyBaseCode\":\"" + ontologyBaseCode + "\"";
    }

    /**
     * 按系统来源、资源类型和资源编码查询资源。
     *
     * @param systemCode      系统来源
     * @param resourceBizType 资源业务类型
     * @param resourceCode    资源编码
     * @return 匹配的资源，不存在时返回 null
     */
    public SsResource findByImportIdentity(String systemCode, String resourceBizType, String resourceCode) {
        QueryWrapper<SsResource> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("system_code", systemCode)
            .eq("resource_biz_type", resourceBizType)
            .eq("resource_code", resourceCode);
        return ssResourceMapper.selectOne(queryWrapper);
    }

    /**
     * 批量按主键查询资源列表
     *
     * @param resourceIds 资源主键集合，空集合时返回空列表
     * @return 资源列表
     */
    public List<SsResource> findByIdList(Collection<Long> resourceIds) {
        if (ListUtil.isEmpty(resourceIds)) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResource::getResourceId, resourceIds);
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 查询某个创建人名下 owner_type=personal_default 的数字员工资源。
     *
     * @author qin.guoquan
     * @date 2026-05-11
     */
    public List<SsResource> findPersonalDefaultDigitalEmployeesByCreator(Long createBy) {
        if (createBy == null) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getCreateBy, createBy)
            .eq(SsResource::getResourceBizType, "DIG_EMPLOYEE")
            .eq(SsResource::getOwnerType, "personal_default");
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 统计同名资源数量（用于校验重名）
     *
     * @param resourceName      资源名称
     * @param resourceBizType   资源业务类型，可空表示不按类型过滤
     * @param resourceIdNoEqual 排除的资源主键（编辑时排除自身），可空
     * @return 匹配条数
     */
    public long countResource(String resourceName, String resourceBizType, String ownerType, Long resourceIdNoEqual) {

        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();

        if (OwnerType.PERSONAL.equalsIgnoreCase(ownerType)) {
            queryWrapper.eq(SsResource::getCreateBy, CurrentUserHolder.getCurrentUserId());
        }

        queryWrapper.eq(SsResource::getResourceName, resourceName);
        if (StringUtil.isNotEmpty(resourceBizType)) {
            queryWrapper.eq(SsResource::getResourceBizType, resourceBizType);
        }

        if (resourceIdNoEqual != null) {
            queryWrapper.notIn(SsResource::getResourceId, resourceIdNoEqual);
        }
        return ssResourceMapper.selectCount(queryWrapper);
    }

    /**
     * 生成不重名的资源名称。若基础名称已存在，则按已有基础名称数量追加“(x)”。
     *
     * @param baseName        基础名称
     * @param resourceBizType 资源业务类型，可空表示全类型校验
     * @return 可用资源名称
     */
    public String generateAvailableResourceName(String baseName, String resourceBizType) {
        long sameBaseNameCount = this.countResource(baseName, resourceBizType, null, null);
        if (sameBaseNameCount <= 0) {
            return baseName;
        }

        int suffix = Math.toIntExact(sameBaseNameCount + 1);
        String availableName = baseName + "(" + suffix + ")";
        while (this.countResource(availableName, resourceBizType, null, null) > 0) {
            suffix++;
            availableName = baseName + "(" + suffix + ")";
        }
        return availableName;
    }

    /**
     * 查询资源关联的其他资源列表
     *
     * @param resourceId 资源标识
     * @return List<SsResource>
     */
    public List<SsResourceDTO> findRelResource(Long resourceId) {
        return ssResourceMapper.findRelResource(resourceId);
    }

    /**
     * 根据父资源主键查询子资源列表
     *
     * @param parentResourceId 上级资源标识
     * @return 子资源列表
     */
    public List<SsResource> findByParentResourceId(Long parentResourceId) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getParentResourceId, parentResourceId);
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 审核通过子资源状态
     *
     * @param parentResourceId 父资源标识
     */
    public void approvalByParentResourceId(Long parentResourceId) {

        SsResource ssResource = new SsResource();
        ssResource.setAuthStatus("passed");
        ssResource.setResourceStatus(ResourceStatus.LIST.getNum());

        LambdaUpdateWrapper<SsResource> updateWrapper = new LambdaUpdateWrapper<>();
        updateWrapper.eq(SsResource::getParentResourceId, parentResourceId);

        ssResourceMapper.update(ssResource, updateWrapper);
    }

    /**
     * 按资源编码批量查询主表记录
     *
     * @param codes resourceCode 列表
     * @return 资源列表
     */
    public List<SsResource> getResourceListByCode(List<String> codes) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResource::getResourceCode, codes);
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 按知识库编码查询知识库资源主表记录，仅返回 KG_ 开头的资源。
     */
    public List<SsResource> findKnowledgeResourcesByCode(String resourceCode) {
        if (StringUtil.isEmpty(resourceCode)) {
            return Collections.emptyList();
        }
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceCode, resourceCode);
        queryWrapper.likeRight(SsResource::getResourceBizType, "KG_");
        return ssResourceMapper.selectList(queryWrapper);
    }

    /**
     * 根据入参中的 {@code resourceId} 查询数字员工扩展表首条记录
     *
     * @param params 需包含 resourceId
     * @return 扩展实体，无记录时返回 null
     */
    public SsResExtDigEmployee getDigEmployeeExtInfo(Map<String, Object> params) {
        Long resourceId = Long.valueOf(MapUtils.getString(params, "resourceId"));
        LambdaQueryWrapper<SsResExtDigEmployee> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResExtDigEmployee::getResourceId, resourceId);
        List<SsResExtDigEmployee> ssResExtDigEmployees = ssResExtDigEmployeeMapper.selectList(queryWrapper);
        return ssResExtDigEmployees.isEmpty() ? null : ssResExtDigEmployees.getFirst();
    }

    /**
     * 按层级查询目录与文件（知识目录树）
     *
     * @param dirAndFileQo 查询条件
     * @return 目录与文件视图列表
     */
    public List<DirAndFileVo> queryDirAndFileByLevel(DirAndFileQo dirAndFileQo) {
        return ssResourceMapper.queryDirAndFileByLevel(dirAndFileQo);
    }

    /**
     * 查询文档库详情
     *
     * @param resourceId 资源标识
     * @return DatasetDetailVo
     */
    public DatasetDetailVo findDatasetDetailById(Long resourceId) {
        return ssResourceMapper.findDatasetDetailById(resourceId);
    }

    /**
     * 构建默认资源编码：systemCode + "_" + resourceBizType + "_" + resourceId
     *
     * @param resource 已赋主键与业务类型的资源
     * @return 编码字符串
     */
    private String buildResourceCode(SsResource resource) {
        return resource.getSystemCode() + "_" + resource.getResourceBizType() + "_" + resource.getResourceId();
    }

    /**
     * 统一补齐新增资源主表记录的默认字段，不覆盖业务方法已显式设置的值。
     *
     * @author qin.guoquan
     * @date 2026-04-26 12:05:00
     */
    public void fillCreateDefaults(SsResource ssResource) {
        if (ssResource == null) {
            return;
        }
        if (ssResource.getResourceId() == null) {
            ssResource.setResourceId(sequenceService.nextVal());
        }
        if (StringUtil.isEmpty(ssResource.getSystemCode())) {
            ssResource.setSystemCode(SystemCode.BYAI.getCode());
        }
        if (ssResource.getCatalogId() == null) {
            ssResource.setCatalogId(0L);
        }
        if (StringUtil.isEmpty(ssResource.getResourceCode())) {
            ssResource.setResourceCode(this.buildResourceCode(ssResource));
        }
        if (ssResource.getCreateTime() == null) {
            ssResource.setCreateTime(new Date());
        }
        if (ssResource.getCreateBy() == null) {
            ssResource.setCreateBy(CurrentUserHolder.getCurrentUserId());
        }
        if (ssResource.getUpdateBy() == null) {
            ssResource.setUpdateBy(ssResource.getCreateBy());
        }
        if (ssResource.getUpdateTime() == null) {
            ssResource.setUpdateTime(ssResource.getCreateTime());
        }
        if (ssResource.getResourceDVerid() == null) {
            ssResource.setResourceDVerid(-1L);
        }
        if (ssResource.getResourceRVerid() == null) {
            ssResource.setResourceRVerid(-1L);
        }
        if (ssResource.getParentResourceId() == null) {
            ssResource.setParentResourceId(-1L);
        }
        if (StringUtil.isEmpty(ssResource.getResourceType())) {
            ssResource.setResourceType("ATOM");
        }
        if (StringUtil.isEmpty(ssResource.getAuthStatus())) {
            ssResource.setAuthStatus("passed");
        }
        if (StringUtil.isEmpty(ssResource.getPublishType())) {
            ssResource.setPublishType("publish");
        }
        if (ssResource.getPublishPortal() == null) {
            ssResource.setPublishPortal(1);
        }
        if (ssResource.getPublishTime() == null) {
            ssResource.setPublishTime(new Date());
        }
        if (StringUtil.isEmpty(ssResource.getHostType())) {
            ssResource.setHostType("hosted");
        }
        if (StringUtil.isEmpty(ssResource.getManUserId())) {
            ssResource.setManUserId(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        }
        if (ssResource.getManOrgId() == null) {
            List<Long> belongOrgIds = CurrentUserHolder.getBelongOrgIds();
            ssResource.setManOrgId(!belongOrgIds.isEmpty() ? belongOrgIds.getFirst() : null);
        }
        if (ssResource.getComAcctId() == null) {
            ssResource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        }
    }

    /**
     * 统一补齐更新资源主表记录的审计字段。
     *
     * @author qin.guoquan
     * @date 2026-04-26 12:05:00
     */
    public void fillUpdateDefaults(SsResource ssResource) {
        if (ssResource == null) {
            return;
        }
        if (ssResource.getUpdateBy() == null) {
            ssResource.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        }
        if (ssResource.getUpdateTime() == null) {
            ssResource.setUpdateTime(new Date());
        }
    }

    /**
     * 创建资源主表记录（分配主键、默认系统码、父子与发布类型等）
     *
     * @param resourceBizType   资源业务类型
     * @param resourceCode      业务侧传入的资源编码
     * @param resourceName      名称
     * @param resourceDesc      描述，可空
     * @param resourceStatus    状态枚举数值
     * @param ownerType         资源归属类型：enterprise-企业，personal-个人
     * @param systemCode        系统来源
     * @param resourceVersionId 资源版本
     * @param catalodId         资源目录
     * @return 插入后的实体
     */
    public SsResource createResource(String resourceBizType, String resourceCode, String resourceName,
                                     String resourceDesc, Integer resourceStatus, String ownerType, String systemCode, String resourceVersionId,
                                     Long catalodId) {

        SsResource ssResource = new SsResource();
        ssResource.setResourceBizType(resourceBizType);

        if (StringUtil.isEmpty(systemCode))
            systemCode = SystemCode.BYAI.getCode();
        ssResource.setSystemCode(systemCode);

        if (null == catalodId)
            catalodId = 0L;
        ssResource.setCatalogId(catalodId);

        if (StringUtil.isNotEmpty(resourceVersionId))
            resourceVersionId = "1.0.0";
        ssResource.setResourceVersionId(resourceVersionId);

        if (StringUtil.isNotEmpty(resourceCode)) {
            ssResource.setResourceCode(resourceCode);
        }

        ssResource.setResourceName(resourceName);
        ssResource.setResourceDesc(resourceDesc);
        ssResource.setResourceStatus(resourceStatus);
        ssResource.setOwnerType(ownerType);

        if (StringUtil.isEmpty(ssResource.getImplType())) {
            ssResource.setImplType(ImplType.ASK_AGENT.getCode());
        }

        if (StringUtil.isEmpty(ssResource.getWorkerAgentType())) {
            ssResource.setWorkerAgentType(WorkerAgentType.BYCLAW_QA.getCode());
        }

        return saveResource(ssResource);
    }

    public SsResource createResource(SsResource ssResource) {

        if (null == ssResource)
            ssResource = new SsResource();

        if (StringUtil.isEmpty(ssResource.getSystemCode()))
            ssResource.setSystemCode(SystemCode.BYAI.getCode());

        if (null == ssResource.getCatalogId())
            ssResource.setCatalogId(0L);
        ssResource.setCatalogId(ssResource.getCatalogId());

        if (StringUtil.isNotEmpty(ssResource.getResourceVersionId()))
            ssResource.setResourceVersionId("1.0.0");
        ssResource.setResourceVersionId(ssResource.getResourceVersionId());

        return saveResource(ssResource);
    }

    /**
     * 更新资源名称与描述，并刷新更新人、更新时间
     *
     * @param resourceId   资源主键
     * @param resourceName 新名称
     * @param resourceDesc 新描述
     * @return 更新后的实体
     */
    public SsResource updateResource(Long resourceId, String resourceName, String resourceDesc) {

        SsResource ssResource = ssResourceMapper.selectById(resourceId);
        ssResource.setResourceName(resourceName);
        ssResource.setResourceDesc(resourceDesc);
        return updateResourceEntity(ssResource);
    }

    /**
     * 统计资源数量
     *
     * @param request 请求
     * @return List
     */
    public List<Map<Integer, Long>> getStatusNumStatics(ResourceQueryRequest request) {
        return ssResourceMapper.getStatusNumStatics(request);
    }

    /**
     * 分页查询资源列表信息,已上架的
     *
     * @param resourceQo 查询对象
     * @return PageVO
     */
    public PageInfo<SsResource> selectResourceByQo(ResourceQo resourceQo) {

        com.baomidou.mybatisplus.extension.plugins.pagination.Page<SsResource> page = new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(
            resourceQo.getPageNum(), resourceQo.getPageSize());

        QueryWrapper<SsResource> queryWrapper = new QueryWrapper<>();
        queryWrapper.eq("resource_status", ResourceStatus.LIST.getNum());

        if (ListUtil.isNotEmpty(resourceQo.getResourceIds())) {
            queryWrapper.in("resource_id", resourceQo.getResourceIds());
        }

        if (ListUtil.isNotEmpty(resourceQo.getResourceBizTypes())) {
            queryWrapper.in("resource_biz_type", resourceQo.getResourceBizTypes());
        }

        if (StringUtil.isNotEmpty(resourceQo.getKeyword())) {
            queryWrapper.like("resource_name", resourceQo.getKeyword());
        }

        if (resourceQo.getCreateBy() != null) {
            queryWrapper.eq("create_by", resourceQo.getCreateBy());
        }

        com.baomidou.mybatisplus.extension.plugins.pagination.Page<SsResource> ssResourcePage = ssResourceMapper
            .selectPage(page, queryWrapper);
        return PageHelperUtil.toPageInfo(ssResourcePage);
    }

    /**
     * 分页查询未注销的数字员工资源（用于启动时 Redis 全量同步等批处理场景）。
     *
     * @param pageNum  页码，从 1 开始
     * @param pageSize 每页条数
     * @return 当前页资源列表，无数据时返回空列表
     */
    public List<SsResource> pageActiveDigitalEmployees(int pageNum, int pageSize) {
        int safePageNum = pageNum > 0 ? pageNum : 1;
        int safePageSize = pageSize > 0 ? pageSize : 1000;
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceBizType, ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        queryWrapper.ne(SsResource::getResourceStatus, ResourceStatus.REMOVED.getNum());
        queryWrapper.orderByAsc(SsResource::getResourceId);
        com.baomidou.mybatisplus.extension.plugins.pagination.Page<SsResource> page =
            new com.baomidou.mybatisplus.extension.plugins.pagination.Page<>(safePageNum, safePageSize, false);
        return ssResourceMapper.selectPage(page, queryWrapper).getRecords();
    }

    /**
     * 查询未注销的全部数字员工资源，用于按当前用户权限二次筛选的轻量列表场景。
     */
    public List<SsResource> listActiveDigitalEmployees() {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceBizType, ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        queryWrapper.ne(SsResource::getResourceStatus, ResourceStatus.REMOVED.getNum());
        queryWrapper.orderByAsc(SsResource::getResourceName);
        queryWrapper.orderByAsc(SsResource::getResourceId);
        return ssResourceMapper.selectList(queryWrapper);
    }


    /**
     * 根据编码统计资源数量
     *
     * @param resourceCodes 资源编码
     * @return long
     */
    public long countByResourceCodes(List<String> resourceCodes) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(SsResource::getResourceCode, resourceCodes);
        Long count = ssResourceMapper.selectCount(queryWrapper);
        return count != null ? count : 0L;
    }
}
