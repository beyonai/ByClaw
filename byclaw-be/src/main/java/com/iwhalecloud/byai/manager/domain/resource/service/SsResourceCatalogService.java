package com.iwhalecloud.byai.manager.domain.resource.service;

import com.baomidou.mybatisplus.core.conditions.query.QueryWrapper;
import com.iwhalecloud.byai.common.constants.Constants;
import com.iwhalecloud.byai.state.domain.sys.service.ByaiSystemConfigService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogTreeVO;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceCatalogMapper;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import com.iwhalecloud.byai.manager.qo.resource.CatalogDto;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.Collections;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.stream.Collectors;
import org.apache.commons.collections.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming &#064;date 2025-10-30 11:12:09 &#064;description 资源目录服务
 */
@Service
public class SsResourceCatalogService {

    private static final Logger logger = LoggerFactory.getLogger(SsResourceCatalogService.class);

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private SsResourceCatalogMapper ssResourceCatalogMapper;

    @Autowired
    private ByaiSystemConfigService byaiSystemConfigService;

    /**
     * 创建目录
     *
     * @param catalog 目录信息
     * @return 创建的目录对象
     */
    public SsResourceCatalog createCatalog(CatalogDto catalog) {
        // 参数校验
        if (StringUtils.isBlank(catalog.getCatalogName())) {
            throw new BaseException(I18nUtil.get("resource.catalog.name.not.null"));
        }
        if (catalog.getCatalogType() == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.type.not.null"));
        }

        // 检查同级目录下是否存在同名目录
        LambdaQueryWrapper<SsResourceCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceCatalog::getCatalogName, catalog.getCatalogName());
        queryWrapper.eq(SsResourceCatalog::getCatalogType, catalog.getCatalogType());
        if (catalog.getPCatalogId() != null) {
            queryWrapper.eq(SsResourceCatalog::getPCatalogId, catalog.getPCatalogId());
        }
        else {
            queryWrapper.eq(SsResourceCatalog::getPCatalogId, -1L);
        }
        Long count = ssResourceCatalogMapper.selectCount(queryWrapper);
        if (count > 0) {
            throw new BaseException(I18nUtil.get("resource.catalog.name.duplicate"));
        }
        SsResourceCatalog newCatalog = new SsResourceCatalog();
        BeanUtils.copyProperties(catalog, newCatalog);
        // 设置创建信息
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        newCatalog.setCreateBy(currentUserId);
        newCatalog.setCreateTime(new Date());
        newCatalog.setUpdateBy(currentUserId);
        newCatalog.setUpdateTime(new Date());

        // 没有默认为1
        if (newCatalog.getOrderIndex() == null) {
            newCatalog.setOrderIndex(1);
        }
        // 如果没有指定父目录ID，设置为-1表示根目录
        if (newCatalog.getPCatalogId() == null) {
            newCatalog.setPCatalogId(-1L);
        }
        newCatalog.setCatalogId(sequenceService.nextVal());
        // 构建catalog_path
        String catalogPath = this.buildCatalogPath(newCatalog.getPCatalogId(), newCatalog.getCatalogId());

        // 检查目录层级尝试
        String maxDepthLevelStr = byaiSystemConfigService.getDcSystemConfigValueByCode("CATALOG_PATH_MAX_DEPTH_LEVEL");
        int maxDepthLevel = Constants.CATALOG_PATH_MAX_DEPTH_LEVEL;
        if (StringUtil.isNotEmpty(maxDepthLevelStr)) {
            maxDepthLevel = Integer.parseInt(maxDepthLevelStr);
        }

        if (catalogPath.split("\\.").length - 1 > maxDepthLevel) {
            throw new BaseException("目录层级超过最大限制(" + maxDepthLevel + "层)");
        }

        newCatalog.setCatalogPath(catalogPath);

        // 插入数据库（先插入以获取catalogId）
        int result = ssResourceCatalogMapper.insert(newCatalog);
        if (result <= 0) {
            throw new BaseException(I18nUtil.get("resource.catalog.create.failed"));
        }
        logger.info("创建目录成功, catalogId: {}, catalogName: {}, catalogPath: {}", newCatalog.getCatalogId(),
            newCatalog.getCatalogName(), catalogPath);
        return newCatalog;
    }

    /**
     * 构建目录路径 如果有父目录，则路径为：父目录路径.当前目录ID 如果是根目录（pCatalogId为-1或null），则路径为：当前目录ID
     *
     * @param pCatalogId 父目录ID
     * @param catalogId 当前目录ID
     * @return 目录路径，用.隔开
     */
    private String buildCatalogPath(Long pCatalogId, Long catalogId) {
        // 如果是根目录（pCatalogId为-1或null），路径就是当前目录ID
        if (pCatalogId == -1) {
            return pCatalogId + "." + catalogId;
        }

        // 查询父目录信息
        SsResourceCatalog parentCatalog = ssResourceCatalogMapper.selectById(pCatalogId);
        if (parentCatalog == null) {
            // 如果父目录不存在，使用父目录ID作为路径前缀
            logger.warn("父目录不存在, pCatalogId: " + pCatalogId + ", 使用父目录ID作为路径前缀");
            return pCatalogId + "." + catalogId;
        }

        // 如果父目录有catalog_path，则拼接：父目录路径.当前目录ID
        if (StringUtils.isNotBlank(parentCatalog.getCatalogPath())) {
            return parentCatalog.getCatalogPath() + "." + catalogId;
        }

        // 如果父目录没有catalog_path（可能是旧数据），则使用：父目录ID.当前目录ID
        logger.warn("父目录没有catalog_path, pCatalogId: " + pCatalogId + ", 使用父目录ID作为路径前缀");
        return pCatalogId + "." + catalogId;
    }

    /**
     * 更新目录
     *
     * @param catalog 目录信息
     * @return 更新后的目录对象
     */
    public SsResourceCatalog updateCatalog(CatalogDto catalog) {
        // 参数校验
        if (catalog.getCatalogId() == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.id.not.null"));
        }
        if (StringUtils.isBlank(catalog.getCatalogName())) {
            throw new BaseException(I18nUtil.get("resource.catalog.name.not.null"));
        }

        // 检查目录是否存在
        SsResourceCatalog existingCatalog = ssResourceCatalogMapper.selectById(catalog.getCatalogId());
        if (existingCatalog == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.not.exist"));
        }

        // 检查同级目录下是否存在同名目录（排除自己）
        LambdaQueryWrapper<SsResourceCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceCatalog::getCatalogName, catalog.getCatalogName());
        queryWrapper.eq(SsResourceCatalog::getCatalogType, existingCatalog.getCatalogType());
        queryWrapper.ne(SsResourceCatalog::getCatalogId, catalog.getCatalogId());
        if (existingCatalog.getPCatalogId() != null && existingCatalog.getPCatalogId() != -1) {
            queryWrapper.eq(SsResourceCatalog::getPCatalogId, existingCatalog.getPCatalogId());
        }
        else {
            queryWrapper.and(wrapper -> wrapper.isNull(SsResourceCatalog::getPCatalogId).or()
                .eq(SsResourceCatalog::getPCatalogId, -1));
        }
        Long count = ssResourceCatalogMapper.selectCount(queryWrapper);
        if (count > 0) {
            throw new BaseException(I18nUtil.get("resource.catalog.name.duplicate"));
        }
        BeanUtils.copyProperties(catalog, existingCatalog);

        generateNewPath(catalog, existingCatalog);

        // 更新目录信息（保留创建信息）
        existingCatalog.setCreateBy(existingCatalog.getCreateBy());
        existingCatalog.setCreateTime(existingCatalog.getCreateTime());
        existingCatalog.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        existingCatalog.setUpdateTime(new Date());
        existingCatalog.setPCatalogId(existingCatalog.getPCatalogId()); // 父目录ID不允许修改

        // 更新数据库
        int result = ssResourceCatalogMapper.updateById(existingCatalog);
        if (result <= 0) {
            throw new BaseException(I18nUtil.get("resource.catalog.update.failed"));
        }

        logger.info("更新目录成功, catalogName: {}", existingCatalog.getCatalogName());
        return existingCatalog;
    }

    private void generateNewPath(CatalogDto catalog, SsResourceCatalog existingCatalog) {
        if (catalog.getPCatalogId() != null) {
            // 重新生成路径
            List<SsResourceCatalog> parentCatalog = ssResourceCatalogMapper
                .selectList(new QueryWrapper<SsResourceCatalog>().eq("catalog_id", catalog.getPCatalogId()));
            if (CollectionUtils.isNotEmpty(parentCatalog)) {
                existingCatalog.setPCatalogId(catalog.getPCatalogId());
                String path = parentCatalog.get(0).getCatalogPath() + "." + catalog.getCatalogId();
                existingCatalog.setCatalogPath(path);
            }

        }
    }

    /**
     * 删除目录
     *
     * @param catalogId 目录ID
     * @return 删除结果
     */
    public boolean deleteCatalog(Long catalogId) {
        // 参数校验
        if (catalogId == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.id.not.null"));
        }

        // 检查目录是否存在
        SsResourceCatalog catalog = ssResourceCatalogMapper.selectById(catalogId);
        if (catalog == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.not.exist"));
        }

        // 检查是否有子目录
        LambdaQueryWrapper<SsResourceCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceCatalog::getPCatalogId, catalogId);
        Long childCount = ssResourceCatalogMapper.selectCount(queryWrapper);
        if (childCount > 0) {
            throw new BaseException(I18nUtil.get("resource.catalog.has.children"));
        }

        // todo 有使用该目录的，这个目录能删掉吗
        // 删除目录
        int result = ssResourceCatalogMapper.deleteById(catalogId);
        if (result <= 0) {
            throw new BaseException(I18nUtil.get("resource.catalog.delete.failed"));
        }

        logger.info("删除目录成功, catalogName: {}", catalog.getCatalogName());
        return true;
    }

    /**
     * 根据ID查询目录
     *
     * @param catalogId 目录ID
     * @return 目录对象
     */
    public CatalogDto queryCatalogById(Long catalogId) {
        if (catalogId == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.id.not.null"));
        }
        return ssResourceCatalogMapper.queryCatalogById(catalogId);
    }

    /**
     * 查询目录列表
     *
     * @param catalogQo 查询条件
     * @return 目录列表
     */
    public List<SsResourceCatalog> queryCatalogList(CatalogQo catalogQo) {
        LambdaQueryWrapper<SsResourceCatalog> queryWrapper = new LambdaQueryWrapper<>();
        if (catalogQo != null && catalogQo.getCatalogType() != null) {
            queryWrapper.eq(SsResourceCatalog::getCatalogType, catalogQo.getCatalogType());
        }
        queryWrapper.orderByAsc(SsResourceCatalog::getCreateTime);
        return ssResourceCatalogMapper.selectList(queryWrapper);
    }

    /**
     * 根据父目录ID查询子目录列表
     *
     * @param pCatalogId 父目录ID
     * @return 子目录列表
     */
    public List<SsResourceCatalog> queryChildrenByParentId(Long pCatalogId) {
        if (pCatalogId == null) {
            throw new BaseException(I18nUtil.get("resource.catalog.parent.id.not.null"));
        }
        return ssResourceCatalogMapper.queryChildrenByParentId(pCatalogId);
    }

    /**
     * 查询目录树
     *
     * @param catalogQo 查询条件
     * @return 目录树列表
     */
    public List<SsResourceCatalog> queryCatalogTree(CatalogQo catalogQo) {
        List<SsResourceCatalog> ssResourceCatalogs = ssResourceCatalogMapper.queryCatalogTree(catalogQo);
        // 只有当模糊查询时
        if (null != catalogQo.getContainsParent() && catalogQo.getContainsParent()) {
            List<Long> orgIds = new ArrayList<>();
            for (SsResourceCatalog ssResourceCatalog : ssResourceCatalogs) {
                String pathCode = ssResourceCatalog.getCatalogPath();
                if (StringUtil.isEmpty(pathCode)) {
                    continue;
                }
                String[] split = pathCode.split("\\.");
                for (String orgIdStr : split) {
                    orgIds.add(Long.parseLong(orgIdStr));
                }
            }

            return ssResourceCatalogMapper.queryCatalogTree(new CatalogQo(orgIds));
        }
        // 工具和插件共用一个发布目录
        return ssResourceCatalogMapper.queryCatalogTree(catalogQo);
    }

    public List<ResourceCatalogDto> queryResourceListByCatalogId(CatalogDto catalogDto) {
        return ssResourceCatalogMapper.queryResourceListByCatalogId(catalogDto);
    }

    /**
     * 查询资源目录关联树 关联查询 ss_resource 和 ss_resource_catalog 表
     *
     * @param catalogType 目录类型（可选，6-领域活动对象，7-核心业务对象）
     * @return 资源目录关联树形结构列表
     */
    public List<ResourceCatalogTreeVO> queryResourceCatalogTree(Integer catalogType) {
        // 查询平铺数据
        List<ResourceCatalogTreeVO> flatList = ssResourceCatalogMapper.queryResourceCatalogTree(catalogType);

        // 构建树形结构
        return buildTree(flatList);
    }

    /**
     * 构建树形结构 根据 catalogPath 和 relResourceId 构建树形结构
     *
     * @param flatList 平铺数据列表
     * @return 树形结构列表
     */
    private List<ResourceCatalogTreeVO> buildTree(List<ResourceCatalogTreeVO> flatList) {
        if (CollectionUtils.isEmpty(flatList)) {
            return new ArrayList<>();
        }

        // 用于存储所有节点的映射，key为catalogId，value为节点
        Map<Long, ResourceCatalogTreeVO> nodeMap = new HashMap<>();
        // 用于存储根节点（pCatalogId为-1的节点）
        List<ResourceCatalogTreeVO> rootNodes = new ArrayList<>();
        // 用于存储对象节点（有relResourceId的节点），按relCatalogId分组
        Map<Long, List<ResourceCatalogTreeVO>> objectMap = new HashMap<>();

        // 构建目录节点
        Map<Long, ResourceCatalogTreeVO> tempCatalogMap = buildCatalogNodes(flatList, nodeMap, rootNodes);

        // 创建缺失的目录节点
        createMissingCatalogNodes(tempCatalogMap, nodeMap, rootNodes);

        // 构建对象节点
        buildObjectNodes(flatList, objectMap);

        // 构建目录层级关系
        buildCatalogHierarchy(flatList, nodeMap, rootNodes);

        // 将对象节点添加到对应的目录节点下
        attachObjectsToCatalogs(objectMap, nodeMap);

        // 对根节点和子节点进行排序
        sortTree(rootNodes);

        return rootNodes;
    }

    /**
     * 构建目录节点
     *
     * @param flatList 平铺数据列表
     * @param nodeMap 节点映射
     * @param rootNodes 根节点列表
     * @return 临时目录映射
     */
    private Map<Long, ResourceCatalogTreeVO> buildCatalogNodes(List<ResourceCatalogTreeVO> flatList,
        Map<Long, ResourceCatalogTreeVO> nodeMap, List<ResourceCatalogTreeVO> rootNodes) {
        Map<Long, ResourceCatalogTreeVO> tempCatalogMap = new HashMap<>();

        for (ResourceCatalogTreeVO item : flatList) {
            Long catalogId = item.getCatalogId();
            if (catalogId == null) {
                continue;
            }

            if (isCatalogNode(item)) {
                processCatalogNode(item, catalogId, nodeMap, tempCatalogMap, rootNodes);
            }
            else {
                processObjectNodeForCatalog(item, catalogId, nodeMap, tempCatalogMap);
            }
        }

        return tempCatalogMap;
    }

    /**
     * 判断是否为目录节点
     */
    private boolean isCatalogNode(ResourceCatalogTreeVO item) {
        return item.getRelResourceId() == null || StringUtils.isBlank(item.getResourceName());
    }

    /**
     * 处理目录节点
     */
    private void processCatalogNode(ResourceCatalogTreeVO item, Long catalogId,
        Map<Long, ResourceCatalogTreeVO> nodeMap, Map<Long, ResourceCatalogTreeVO> tempCatalogMap,
        List<ResourceCatalogTreeVO> rootNodes) {
        if (nodeMap.containsKey(catalogId)) {
            return;
        }

        ResourceCatalogTreeVO catalogNode = createCatalogNode(item, catalogId);
        nodeMap.put(catalogId, catalogNode);
        tempCatalogMap.put(catalogId, item);

        if (isRootNode(item)) {
            rootNodes.add(catalogNode);
        }
    }

    /**
     * 处理对象节点中的目录信息
     */
    private void processObjectNodeForCatalog(ResourceCatalogTreeVO item, Long catalogId,
        Map<Long, ResourceCatalogTreeVO> nodeMap, Map<Long, ResourceCatalogTreeVO> tempCatalogMap) {
        if (nodeMap.containsKey(catalogId) || tempCatalogMap.containsKey(catalogId)) {
            return;
        }

        ResourceCatalogTreeVO catalogInfo = extractCatalogInfo(item, catalogId);
        tempCatalogMap.put(catalogId, catalogInfo);
    }

    /**
     * 创建目录节点
     */
    private ResourceCatalogTreeVO createCatalogNode(ResourceCatalogTreeVO item, Long catalogId) {
        ResourceCatalogTreeVO catalogNode = new ResourceCatalogTreeVO();
        catalogNode.setCatalogName(item.getCatalogName());
        catalogNode.setCatalogId(catalogId);
        catalogNode.setPCatalogId(item.getPCatalogId());
        catalogNode.setCatalogType(item.getCatalogType());
        catalogNode.setCatalogPath(item.getCatalogPath());
        catalogNode.setOrderIndex(item.getOrderIndex());
        catalogNode.setChildren(new ArrayList<>());
        return catalogNode;
    }

    /**
     * 从对象节点中提取目录信息
     */
    private ResourceCatalogTreeVO extractCatalogInfo(ResourceCatalogTreeVO item, Long catalogId) {
        ResourceCatalogTreeVO catalogInfo = new ResourceCatalogTreeVO();
        catalogInfo.setCatalogName(item.getCatalogName());
        catalogInfo.setCatalogId(catalogId);
        catalogInfo.setPCatalogId(item.getPCatalogId());
        catalogInfo.setCatalogType(item.getCatalogType());
        catalogInfo.setCatalogPath(item.getCatalogPath());
        catalogInfo.setOrderIndex(item.getOrderIndex());
        return catalogInfo;
    }

    /**
     * 判断是否为根节点
     */
    private boolean isRootNode(ResourceCatalogTreeVO item) {
        return item.getPCatalogId() != null && item.getPCatalogId() == -1L;
    }

    /**
     * 创建缺失的目录节点
     */
    private void createMissingCatalogNodes(Map<Long, ResourceCatalogTreeVO> tempCatalogMap,
        Map<Long, ResourceCatalogTreeVO> nodeMap, List<ResourceCatalogTreeVO> rootNodes) {
        for (Map.Entry<Long, ResourceCatalogTreeVO> entry : tempCatalogMap.entrySet()) {
            Long catalogId = entry.getKey();
            if (nodeMap.containsKey(catalogId)) {
                continue;
            }

            ResourceCatalogTreeVO catalogInfo = entry.getValue();
            ResourceCatalogTreeVO catalogNode = createCatalogNode(catalogInfo, catalogId);
            nodeMap.put(catalogId, catalogNode);

            if (isRootNode(catalogInfo)) {
                rootNodes.add(catalogNode);
            }
        }
    }

    /**
     * 构建对象节点
     */
    private void buildObjectNodes(List<ResourceCatalogTreeVO> flatList,
        Map<Long, List<ResourceCatalogTreeVO>> objectMap) {
        for (ResourceCatalogTreeVO item : flatList) {
            if (!isObjectNode(item)) {
                continue;
            }

            Long relCatalogId = getRelCatalogId(item);
            if (relCatalogId == null) {
                logger.info("对象节点缺少目录ID，resourceName: {}, relResourceId: {}", item.getResourceName(),
                    item.getRelResourceId());
                continue;
            }

            ResourceCatalogTreeVO objectNode = getResourceCatalogTreeVO(item);
            objectMap.computeIfAbsent(relCatalogId, k -> new ArrayList<>()).add(objectNode);
        }
    }

    /**
     * 判断是否为对象节点
     */
    private boolean isObjectNode(ResourceCatalogTreeVO item) {
        return item.getRelResourceId() != null && StringUtils.isNotBlank(item.getResourceName());
    }

    /**
     * 获取关联的目录ID
     */
    private Long getRelCatalogId(ResourceCatalogTreeVO item) {
        Long relCatalogId = item.getRelCatalogId();
        return relCatalogId != null ? relCatalogId : item.getCatalogId();
    }

    /**
     * 构建目录层级关系
     */
    private void buildCatalogHierarchy(List<ResourceCatalogTreeVO> flatList, Map<Long, ResourceCatalogTreeVO> nodeMap,
        List<ResourceCatalogTreeVO> rootNodes) {
        for (ResourceCatalogTreeVO item : flatList) {
            if (!isCatalogNode(item)) {
                continue;
            }

            Long catalogId = item.getCatalogId();
            if (catalogId == null) {
                continue;
            }

            attachToParent(item, catalogId, nodeMap, rootNodes);
        }
    }

    /**
     * 将节点附加到父节点
     */
    private void attachToParent(ResourceCatalogTreeVO item, Long catalogId, Map<Long, ResourceCatalogTreeVO> nodeMap,
        List<ResourceCatalogTreeVO> rootNodes) {
        Long pCatalogId = item.getPCatalogId();
        ResourceCatalogTreeVO currentNode = nodeMap.get(catalogId);

        if (currentNode == null || pCatalogId == null || pCatalogId == -1L) {
            return;
        }

        ResourceCatalogTreeVO parentNode = nodeMap.get(pCatalogId);
        if (parentNode == null) {
            return;
        }

        if (!isChildAlreadyAdded(parentNode, catalogId)) {
            parentNode.getChildren().add(currentNode);
            rootNodes.remove(currentNode);
        }
    }

    /**
     * 检查子节点是否已添加
     */
    private boolean isChildAlreadyAdded(ResourceCatalogTreeVO parentNode, Long catalogId) {
        return parentNode.getChildren().stream().anyMatch(child -> catalogId.equals(child.getCatalogId()));
    }

    /**
     * 将对象节点添加到对应的目录节点下
     */
    private void attachObjectsToCatalogs(Map<Long, List<ResourceCatalogTreeVO>> objectMap,
        Map<Long, ResourceCatalogTreeVO> nodeMap) {
        for (Map.Entry<Long, List<ResourceCatalogTreeVO>> entry : objectMap.entrySet()) {
            Long catalogId = entry.getKey();
            List<ResourceCatalogTreeVO> objects = entry.getValue();

            if (CollectionUtils.isEmpty(objects)) {
                continue;
            }

            ResourceCatalogTreeVO catalogNode = findCatalogNode(catalogId, objects, nodeMap);
            if (catalogNode != null) {
                catalogNode.getChildren().addAll(objects);
            }
            else {
                logMissingCatalogNode(catalogId, objects);
            }
        }
    }

    /**
     * 查找目录节点
     */
    private ResourceCatalogTreeVO findCatalogNode(Long catalogId, List<ResourceCatalogTreeVO> objects,
        Map<Long, ResourceCatalogTreeVO> nodeMap) {
        ResourceCatalogTreeVO catalogNode = nodeMap.get(catalogId);
        if (catalogNode != null) {
            return catalogNode;
        }

        Long relCatalogId = objects.get(0).getRelCatalogId();
        if (relCatalogId != null && !relCatalogId.equals(catalogId)) {
            return nodeMap.get(relCatalogId);
        }

        return null;
    }

    /**
     * 记录缺失目录节点的日志
     */
    private void logMissingCatalogNode(Long catalogId, List<ResourceCatalogTreeVO> objects) {
        logger.info("找不到目录节点，无法添加对象节点。catalogId: {}, relCatalogId: {}, 对象数量: {}, 对象名称: {}", catalogId,
            objects.get(0).getRelCatalogId(), objects.size(), objects.stream()
                .map(ResourceCatalogTreeVO::getResourceName).filter(Objects::nonNull).collect(Collectors.joining(",")));
    }

    private static ResourceCatalogTreeVO getResourceCatalogTreeVO(ResourceCatalogTreeVO item) {
        ResourceCatalogTreeVO objectNode = new ResourceCatalogTreeVO();
        // 对象节点只保留对象相关字段，不保留目录相关字段
        objectNode.setResourceBizType(item.getResourceBizType());
        objectNode.setResourceType(item.getResourceType());
        objectNode.setResourceName(item.getResourceName());
        objectNode.setRelCatalogId(item.getRelCatalogId());
        objectNode.setRelResourceId(item.getRelResourceId());
        objectNode.setCreateTime(item.getCreateTime());
        // 对象节点没有子节点
        objectNode.setChildren(null);
        return objectNode;
    }

    /**
     * 递归排序树节点
     *
     * @param nodes 节点列表
     */
    private void sortTree(List<ResourceCatalogTreeVO> nodes) {
        if (CollectionUtils.isEmpty(nodes)) {
            return;
        }

        // 排序：先按是否有子节点（目录在前，对象在后），再按 orderIndex（升序），最后按名称排序
        nodes.sort((a, b) -> {

            // 如果都是目录或都是对象，优先按 orderIndex 排序（数字小的排在前面）
            Integer orderIndexA = a.getOrderIndex();
            Integer orderIndexB = b.getOrderIndex();

            // 如果 orderIndex 都不为 null，按 orderIndex 升序排序
            if (orderIndexA != null && orderIndexB != null) {
                return Integer.compare(orderIndexA, orderIndexB);
            }
            else if (orderIndexA != null) {
                // orderIndexA 不为 null，orderIndexB 为 null，orderIndexA 排在前面
                return -1;
            }
            else if (orderIndexB != null) {
                // orderIndexA 为 null，orderIndexB 不为 null，orderIndexB 排在前面
                return 1;
            }
            return 0;
        });

        // 递归排序子节点
        for (ResourceCatalogTreeVO node : nodes) {
            if (CollectionUtils.isNotEmpty(node.getChildren())) {
                sortTree(node.getChildren());
            }
        }
    }

    public SsResourceCatalog findById(Long catalogId) {
        return ssResourceCatalogMapper.selectById(catalogId);
    }

    /**
     * 查询当前目录及其所有子目录 ID。
     */
    public List<Long> findSelfAndDescendantCatalogIds(Long catalogId) {
        if (catalogId == null) {
            return Collections.emptyList();
        }
        SsResourceCatalog catalog = ssResourceCatalogMapper.selectById(catalogId);
        if (catalog == null || StringUtils.isBlank(catalog.getCatalogPath())) {
            return List.of(catalogId);
        }
        return ssResourceCatalogMapper.querySelfAndDescendantIds(catalogId, catalog.getCatalogPath());
    }

    /**
     * 删除目录
     *
     * @param catalogId
     */
    public void remove(Long catalogId) {
        ssResourceCatalogMapper.deleteById(catalogId);
    }

    /**
     * 创建资源目录
     *
     * @param catalogName 目录名称
     * @param catalogDesc 目录描述
     * @param pCatalogId 父目录标识
     * @param resourceId 目录对应的资源标识
     * @return SsResourceCatalog
     */
    public SsResourceCatalog createResourceCatalog(String catalogName, String catalogDesc, Long pCatalogId,
        Long resourceId) {

        Long catalogId = sequenceService.nextVal();

        SsResourceCatalog ssResourceCatalog = new SsResourceCatalog();
        ssResourceCatalog.setCatalogId(catalogId);
        ssResourceCatalog.setPCatalogId(pCatalogId);
        ssResourceCatalog.setCreateTime(new Date());
        ssResourceCatalog.setCatalogName(catalogName);
        ssResourceCatalog.setCatalogDesc(catalogDesc);
        ssResourceCatalog.setResourceId(resourceId);
        ssResourceCatalog.setCreateBy(CurrentUserHolder.getCurrentUserId());
        ssResourceCatalog.setComAcctId(CurrentUserHolder.getEnterpriseId());

        // 设置目录路径
        if (pCatalogId < 0) {
            ssResourceCatalog.setCatalogPath("-1." + catalogId);
        }
        else {
            SsResourceCatalog pSsResourceCatalog = this.findById(pCatalogId);
            ssResourceCatalog.setCatalogPath(pSsResourceCatalog.getCatalogPath() + "." + catalogId);
        }

        ssResourceCatalogMapper.insert(ssResourceCatalog);
        return ssResourceCatalog;
    }

    /**
     * 创建资源目录
     *
     * @param catalogName 目录名称
     * @param catalogDesc 目录描述
     * @return SsResourceCatalog
     */
    public SsResourceCatalog updateResourceCatalog(Long catalogId, String catalogName, String catalogDesc) {
        SsResourceCatalog ssResourceCatalog = this.findById(catalogId);
        ssResourceCatalog.setCatalogName(catalogName);
        ssResourceCatalog.setCatalogDesc(catalogDesc);
        ssResourceCatalog.setUpdateBy(CurrentUserHolder.getEnterpriseId());
        ssResourceCatalog.setUpdateTime(new Date());
        ssResourceCatalogMapper.updateById(ssResourceCatalog);
        return ssResourceCatalog;
    }

    /**
     * 查询目录
     *
     * @param catalogName 目录名称
     * @param resourceId 知识库名称
     * @return SsResourceCatalog
     */
    public SsResourceCatalog findResourceCatalog(String catalogName, Long resourceId) {
        LambdaQueryWrapper<SsResourceCatalog> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResourceCatalog::getCatalogName, catalogName);
        queryWrapper.eq(SsResourceCatalog::getResourceId, resourceId);
        return ssResourceCatalogMapper.selectOne(queryWrapper);

    }
}
