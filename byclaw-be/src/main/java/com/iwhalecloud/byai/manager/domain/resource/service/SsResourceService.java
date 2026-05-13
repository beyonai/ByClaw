package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.github.pagehelper.Page;
import com.github.pagehelper.PageHelper;
import com.iwhalecloud.byai.common.constants.resource.ImplType;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.constants.resource.WorkerAgentType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.dto.digitemploy.SsResourceDTO;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResExtDigEmployeeMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import java.util.Collection;
import java.util.Collections;
import java.util.Date;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.manager.qo.resource.DirAndFileQo;
import com.iwhalecloud.byai.manager.qo.resource.ResourceQo;
import com.iwhalecloud.byai.manager.vo.resource.DirAndFileVo;
import com.iwhalecloud.byai.state.domain.resource.qo.DatasetQo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetDetailVo;
import com.iwhalecloud.byai.state.domain.resource.vo.DatasetVo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.apache.commons.collections.MapUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-09-02 17:51:37
 * @description 资源主表（ss_resource）领域服务：CRUD、分页查询、关联与文档库/数字员工扩展查询
 */
@Service
public class SsResourceService {

    /** 序列服务，用于生成 {@link SsResource#getResourceId()} */
    @Autowired
    private SequenceService sequenceService;

    /** 资源主表 Mapper */
    @Autowired
    private SsResourceMapper ssResourceMapper;

    /** 数字员工扩展表 Mapper */
    @Autowired
    private SsResExtDigEmployeeMapper ssResExtDigEmployeeMapper;

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
     * @param resourceId 资源主键，可空
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
     * @param resourceName 资源名称
     * @param resourceBizType 资源业务类型，可空表示不按类型过滤
     * @param resourceIdNoEqual 排除的资源主键（编辑时排除自身），可空
     * @return 匹配条数
     */
    public long countResource(String resourceName, String resourceBizType, Long resourceIdNoEqual) {

        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
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
     * @param baseName 基础名称
     * @param resourceBizType 资源业务类型，可空表示全类型校验
     * @return 可用资源名称
     */
    public String generateAvailableResourceName(String baseName, String resourceBizType) {
        long sameBaseNameCount = this.countResource(baseName, resourceBizType, null);
        if (sameBaseNameCount <= 0) {
            return baseName;
        }

        int suffix = Math.toIntExact(sameBaseNameCount + 1);
        String availableName = baseName + "(" + suffix + ")";
        while (this.countResource(availableName, resourceBizType, null) > 0) {
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
     * @param resourceBizType 资源业务类型
     * @param resourceCode 业务侧传入的资源编码
     * @param resourceName 名称
     * @param resourceDesc 描述，可空
     * @param resourceStatus 状态枚举数值
     * @param ownerType 资源归属类型：enterprise-企业，personal-个人
     * @param systemCode 系统来源
     * @param resourceVersionId 资源版本
     * @param catalodId 资源目录
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
     * @param resourceId 资源主键
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
}
