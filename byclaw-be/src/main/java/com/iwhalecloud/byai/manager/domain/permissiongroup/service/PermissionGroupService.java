package com.iwhalecloud.byai.manager.domain.permissiongroup.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.alibaba.fastjson.JSON;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.permissiongroup.AuthorizedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.DataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ExcludedObjectDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupBasicInfoDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionGroupDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.PermissionResourceDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceAssociatePermissionGroupsDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.ResourceAttributePermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateAuthorizedObjectDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateDataPermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateResourceAttributePermissionDTO;
import com.iwhalecloud.byai.manager.dto.permissiongroup.UpdateResourcePermissionDTO;
import com.iwhalecloud.byai.manager.dto.resource.SsResourceRelDetailDTO;
import com.iwhalecloud.byai.manager.entity.organization.Organization;
import com.iwhalecloud.byai.manager.entity.permissiongroup.AuthorizedObjectDataPermission;
import com.iwhalecloud.byai.manager.entity.permissiongroup.DefaultDataPermission;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroup;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupAuthorizedObject;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupExcludedObject;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupResource;
import com.iwhalecloud.byai.manager.entity.permissiongroup.PermissionGroupResourceAttribute;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.infrastructure.cache.ShareCacheUtil;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.AuthorizedObjectDataPermissionMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.AvailableObjectMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.DefaultDataPermissionMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupAuthorizedObjectMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupCategoryMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupExcludedObjectMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupResourceAttributeMapper;
import com.iwhalecloud.byai.manager.mapper.permissiongroup.PermissionGroupResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceRelDetailMapper;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedObjectQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AuthorizedUserQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.AvailableObjectQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.PermissionGroupQueryQO;
import com.iwhalecloud.byai.manager.qo.permissiongroup.ResourcePermissionQueryQO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import com.iwhalecloud.byai.common.login.bean.UserStation;
import com.iwhalecloud.byai.common.login.bean.UsersOrganization;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectDataPermissionVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedObjectVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AuthorizedUserVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.AvailableObjectVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.CatalogSimpleVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.DataPermissionVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.DimensionListPermissionVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupAndCatalogResultVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionGroupWithCatalogVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.PermissionResourceVO;
import com.iwhalecloud.byai.manager.vo.permissiongroup.ResourceAttributePermissionVO;
import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections4.CollectionUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 权限组领域服务
 * 负责权限组相关的核心业务逻辑
 */
@Service
public class PermissionGroupService {

    private static final Logger logger = LoggerFactory.getLogger(PermissionGroupService.class);


    @Autowired
    private PermissionGroupMapper permissionGroupMapper;

    @Autowired
    private PermissionGroupResourceMapper permissionGroupResourceMapper;

    @Autowired
    private PermissionGroupResourceAttributeMapper permissionGroupResourceAttributeMapper;

    @Autowired
    private PermissionGroupAuthorizedObjectMapper permissionGroupAuthorizedObjectMapper;

    @Autowired
    private DefaultDataPermissionMapper defaultDataPermissionMapper;

    @Autowired
    private AvailableObjectMapper availableObjectMapper;

    @Autowired
    private PermissionGroupExcludedObjectMapper permissionGroupExcludedObjectMapper;

    @Autowired
    private PermissionGroupCategoryMapper permissionGroupCategoryMapper;

    @Autowired
    private AuthorizedObjectDataPermissionMapper authorizedObjectDataPermissionMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SsResourceRelDetailMapper ssResourceRelDetailMapper;

    /**
     * 分页查询权限组列表
     *
     * @param queryQO 查询条件
     * @return 权限组分页列表
     */
    public Page<PermissionGroupVO> queryPermissionGroupPage(PermissionGroupQueryQO queryQO) {
        Page<PermissionGroupVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        List<PermissionGroupVO> records = permissionGroupMapper.selectPermissionGroupPage(page, queryQO).getRecords();
        page.setRecords(records);
        return page;
    }

    /**
     * 查询权限组详情
     *
     * @param id 权限组ID
     * @return 权限组详情
     */
    public PermissionGroupVO getPermissionGroupDetail(Long id) {
        PermissionGroupVO permissionGroupVO = permissionGroupMapper.selectPermissionGroupDetail(id);
        if (permissionGroupVO == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 查询功能权限
        List<PermissionResourceVO> resourcePermissions = permissionGroupResourceMapper.selectByPermissionGroupId(id);
        permissionGroupVO.setResourcePermissions(resourcePermissions);

        // 查询数据权限
        DataPermissionVO dataPermission = defaultDataPermissionMapper.selectByPermissionGroupId(id);
        permissionGroupVO.setDataPermission(dataPermission);

        return permissionGroupVO;
    }

    /**
     * 新增权限组
     *
     * @param permissionGroupDTO 权限组信息
     * @return 权限组ID
     */
    @Transactional(rollbackFor = Exception.class)
    public Long addPermissionGroup(PermissionGroupDTO permissionGroupDTO) {
        // 校验编码是否重复
        Long codeCount = permissionGroupMapper.countByGroupCode(permissionGroupDTO.getGroupCode(), null);
        if (codeCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.code.exists"));
        }

        // 校验名称是否重复
        Long nameCount = permissionGroupMapper.countByGroupName(permissionGroupDTO.getGroupName(), null);
        if (nameCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.name.exists"));
        }

        // 创建权限组
        PermissionGroup permissionGroup = new PermissionGroup();
        permissionGroup.setId(SequenceService.nextSnowId());
        permissionGroup.setGroupCode(permissionGroupDTO.getGroupCode());
        permissionGroup.setGroupName(permissionGroupDTO.getGroupName());
        permissionGroup.setDescription(permissionGroupDTO.getDescription());
        permissionGroup.setStatus(permissionGroupDTO.getStatus() != null ? permissionGroupDTO.getStatus() : "active");
        permissionGroup.setOrgId(permissionGroupDTO.getOrgId());
        permissionGroup.setParentId(permissionGroupDTO.getParentId());
        permissionGroup.setCategoryId(permissionGroupDTO.getCategoryId());
        permissionGroup.setCreateBy(CurrentUserHolder.getCurrentUserId());
        permissionGroup.setCreateTime(new Date());

        permissionGroupMapper.insert(permissionGroup);

        Long permissionGroupId = permissionGroup.getId();

        // 保存功能权限
        saveResourcePermissions(permissionGroupId, permissionGroupDTO.getResourcePermissions());

        // 保存数据权限
        saveDataPermission(permissionGroupId, permissionGroupDTO.getDataPermission());

        logger.info("新增权限组成功: id={}, groupCode={}", permissionGroupId, permissionGroupDTO.getGroupCode());

        return permissionGroupId;
    }

    /**
     * 修改权限组
     *
     * @param permissionGroupDTO 权限组信息
     */
    @Transactional(rollbackFor = Exception.class)
    public void updatePermissionGroup(PermissionGroupDTO permissionGroupDTO) {
        Long id = permissionGroupDTO.getId();
        if (id == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.id.not.null"));
        }

        // 检查权限组是否存在
        PermissionGroup existingGroup = permissionGroupMapper.selectById(id);
        if (existingGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 校验编码是否重复
        Long codeCount = permissionGroupMapper.countByGroupCode(permissionGroupDTO.getGroupCode(), id);
        if (codeCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.code.exists"));
        }

        // 校验名称是否重复
        Long nameCount = permissionGroupMapper.countByGroupName(permissionGroupDTO.getGroupName(), id);
        if (nameCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.name.exists"));
        }

        // 更新权限组
        existingGroup.setGroupCode(permissionGroupDTO.getGroupCode());
        existingGroup.setGroupName(permissionGroupDTO.getGroupName());
        existingGroup.setDescription(permissionGroupDTO.getDescription());
        if (permissionGroupDTO.getStatus() != null) {
            existingGroup.setStatus(permissionGroupDTO.getStatus());
        }
        existingGroup.setOrgId(permissionGroupDTO.getOrgId());
        existingGroup.setParentId(permissionGroupDTO.getParentId());
        existingGroup.setCategoryId(permissionGroupDTO.getCategoryId());
        existingGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        existingGroup.setUpdateTime(new Date());

        permissionGroupMapper.updateById(existingGroup);

        // 更新功能权限（先删后增）
        if (permissionGroupDTO.getResourcePermissions() != null) {
            permissionGroupResourceMapper.deleteByPermissionGroupId(id);
            saveResourcePermissions(id, permissionGroupDTO.getResourcePermissions());
        }

        // 更新数据权限（先删后增）
        if (permissionGroupDTO.getDataPermission() != null) {
            defaultDataPermissionMapper.deleteByPermissionGroupId(id);
            saveDataPermission(id, permissionGroupDTO.getDataPermission());
        }

        logger.info("修改权限组成功: id={}", id);
    }

    /**
     * 删除权限组
     *
     * @param id 权限组ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void deletePermissionGroup(Long id) {
        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(id);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 检查是否有授权对象
        Long authorizedCount = permissionGroupAuthorizedObjectMapper.countByPermissionGroupId(id);
        if (authorizedCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.has.authorized.objects"));
        }

        // 删除功能权限
        permissionGroupResourceMapper.deleteByPermissionGroupId(id);

        // 删除数据权限
        defaultDataPermissionMapper.deleteByPermissionGroupId(id);

        // 删除权限组
        permissionGroupMapper.deleteById(id);

        logger.info("删除权限组成功: id={}", id);
    }

    /**
     * 分页查询授权对象列表
     *
     * @param queryQO 查询条件
     * @return 授权对象分页列表
     */
    public Page<AuthorizedObjectVO> queryAuthorizedObjectPage(AuthorizedObjectQueryQO queryQO) {
        Page<AuthorizedObjectVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        List<AuthorizedObjectVO> records = permissionGroupAuthorizedObjectMapper.selectAuthorizedObjectPage(page, queryQO).getRecords();
        page.setRecords(records);
        return page;
    }

    /**
     * 添加授权对象
     *
     * @param authorizedObjectDTO 授权对象信息
     */
    @Transactional(rollbackFor = Exception.class)
    public void addAuthorizedObjects(AuthorizedObjectDTO authorizedObjectDTO) {
        Long permissionGroupId = authorizedObjectDTO.getPermissionGroupId();

        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        List<PermissionGroupAuthorizedObject> insertList = new ArrayList<>();
        Date now = new Date();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        for (AuthorizedObjectDTO.AuthorizedObjectItem item : authorizedObjectDTO.getAuthorizedObjects()) {
            // 检查授权对象是否已存在
            Long existCount = permissionGroupAuthorizedObjectMapper.countByObject(
                    permissionGroupId, item.getObjectType(), item.getObjectId());
            if (existCount > 0) {
                logger.warn(String.format("授权对象已存在，跳过: permissionGroupId=%d, objectType=%s, objectId=%d",
                        permissionGroupId, item.getObjectType(), item.getObjectId()));
                continue;
            }

            PermissionGroupAuthorizedObject authorizedObject = new PermissionGroupAuthorizedObject();
            authorizedObject.setId(SequenceService.nextSnowId());
            authorizedObject.setPermissionGroupId(permissionGroupId);
            authorizedObject.setAuthorizedObjectId(item.getObjectId());
            authorizedObject.setObjectType(item.getObjectType());
            authorizedObject.setEffectiveAt(item.getEffectiveFrom());
            authorizedObject.setExpiresAt(item.getEffectiveTo());
            authorizedObject.setCreateBy(currentUserId);
            authorizedObject.setCreateTime(now);

            insertList.add(authorizedObject);
        }

        if (ListUtil.isNotEmpty(insertList)) {
            permissionGroupAuthorizedObjectMapper.batchInsert(insertList);
            logger.info("添加授权对象成功: permissionGroupId={}, count={}", permissionGroupId, insertList.size());
        }
    }

    /**
     * 删除授权对象
     *
     * @param id 关联ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteAuthorizedObject(Long id) {
        PermissionGroupAuthorizedObject authorizedObject = permissionGroupAuthorizedObjectMapper.selectById(id);
        if (authorizedObject == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.authorized.object.not.exist"));
        }

        permissionGroupAuthorizedObjectMapper.deleteById(id);
        logger.info("删除授权对象成功: id={}", id);
    }

    /**
     * 分页查询排除对象列表
     *
     * @param queryQO 查询条件
     * @return 排除对象分页列表
     */
    public Page<AuthorizedObjectVO> queryExcludedObjectPage(AuthorizedObjectQueryQO queryQO) {
        Page<AuthorizedObjectVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        List<AuthorizedObjectVO> records = permissionGroupExcludedObjectMapper.selectExcludedObjectPage(page, queryQO).getRecords();
        page.setRecords(records);
        return page;
    }

    /**
     * 添加排除对象
     *
     * @param excludedObjectDTO 排除对象信息
     */
    @Transactional(rollbackFor = Exception.class)
    public void addExcludedObjects(ExcludedObjectDTO excludedObjectDTO) {
        Long permissionGroupId = excludedObjectDTO.getPermissionGroupId();

        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        List<PermissionGroupExcludedObject> insertList = new ArrayList<>();
        Date now = new Date();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        for (ExcludedObjectDTO.ExcludedObjectItem item : excludedObjectDTO.getExcludedObjects()) {
            // 检查排除对象是否已存在
            Long existCount = permissionGroupExcludedObjectMapper.countByObject(
                    permissionGroupId, item.getObjectType(), item.getObjectId());
            if (existCount > 0) {
                logger.warn(String.format("排除对象已存在，跳过: permissionGroupId=%d, objectType=%s, objectId=%d",
                        permissionGroupId, item.getObjectType(), item.getObjectId()));
                continue;
            }

            PermissionGroupExcludedObject excludedObject = new PermissionGroupExcludedObject();
            excludedObject.setId(SequenceService.nextSnowId());
            excludedObject.setPermissionGroupId(permissionGroupId);
            excludedObject.setExcludedObjectId(item.getObjectId());
            excludedObject.setObjectType(item.getObjectType());
            excludedObject.setEffectiveAt(item.getEffectiveFrom());
            excludedObject.setExpiresAt(item.getEffectiveTo());
            excludedObject.setCreateBy(currentUserId);
            excludedObject.setCreateTime(now);

            insertList.add(excludedObject);
        }

        if (ListUtil.isNotEmpty(insertList)) {
            permissionGroupExcludedObjectMapper.batchInsert(insertList);
            logger.info("添加排除对象成功: permissionGroupId={}, count={}", permissionGroupId, insertList.size());
        }
    }

    /**
     * 删除排除对象
     *
     * @param id 关联ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteExcludedObject(Long id) {
        PermissionGroupExcludedObject excludedObject = permissionGroupExcludedObjectMapper.selectById(id);
        if (excludedObject == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.excluded.object.not.exist"));
        }

        permissionGroupExcludedObjectMapper.deleteById(id);
        logger.info("删除排除对象成功: id={}", id);
    }

    /**
     * 批量删除排除对象
     *
     * @param permissionGroupId 权限组ID
     * @param ids 关联ID列表
     */
    @Transactional(rollbackFor = Exception.class)
    public void batchDeleteExcludedObjects(Long permissionGroupId, List<Long> ids) {
        if (ListUtil.isEmpty(ids)) {
            return;
        }

        // 校验这些ID是否都属于指定的权限组
        List<PermissionGroupExcludedObject> excludedObjects = permissionGroupExcludedObjectMapper.selectBatchIds(ids);
        for (PermissionGroupExcludedObject excludedObject : excludedObjects) {
            if (!permissionGroupId.equals(excludedObject.getPermissionGroupId())) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.excluded.object.delete.only.own"));
            }
        }

        permissionGroupExcludedObjectMapper.batchDeleteByIds(ids);
        logger.info("批量删除排除对象成功: permissionGroupId={}, count={}", permissionGroupId, ids.size());
    }

    /**
     * 保存功能权限
     *
     * @param permissionGroupId 权限组ID
     * @param resourcePermissions 功能权限列表
     */
    private void saveResourcePermissions(Long permissionGroupId, List<PermissionResourceDTO> resourcePermissions) {
        if (ListUtil.isEmpty(resourcePermissions)) {
            return;
        }

        List<PermissionGroupResource> insertList = new ArrayList<>();
        Date now = new Date();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        for (PermissionResourceDTO dto : resourcePermissions) {



                PermissionGroupResource resource = new PermissionGroupResource();

                if (ListUtil.isNotEmpty(dto.getPermissionTypes())) {
                    resource.setPermissionType(JSON.toJSONString(dto.getPermissionTypes()));
                }
                resource.setId(SequenceService.nextSnowId());
                resource.setPermissionGroupId(permissionGroupId);
                resource.setResourceId(dto.getResourceId());
                resource.setResourceType(dto.getResourceType());
                resource.setCreateBy(currentUserId);
                resource.setCreateTime(now);
                insertList.add(resource);

        }

        if (ListUtil.isNotEmpty(insertList)) {
            permissionGroupResourceMapper.batchInsert(insertList);
        }
    }

    /**
     * 保存数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param dataPermissionDTO 数据权限配置
     */
    private void saveDataPermission(Long permissionGroupId, DataPermissionDTO dataPermissionDTO) {
        if (dataPermissionDTO == null) {
            return;
        }

        DefaultDataPermission dataPermission = new DefaultDataPermission();
        dataPermission.setId(SequenceService.nextSnowId());
        dataPermission.setPermissionGroupId(permissionGroupId);
        dataPermission.setDataScopeType(dataPermissionDTO.getDataScopeType());
        dataPermission.setDataScopeConfig(dataPermissionDTO.getDataScopeConfig());
        dataPermission.setFieldPermissions(dataPermissionDTO.getFieldPermissions());
        dataPermission.setRowPermissions(dataPermissionDTO.getRowPermissions());
        dataPermission.setStatus("active");
        dataPermission.setCreateBy(CurrentUserHolder.getCurrentUserId());
        dataPermission.setCreateTime(new Date());

        defaultDataPermissionMapper.insert(dataPermission);
    }

    /**
     * 根据ID查询权限组
     *
     * @param id 权限组ID
     * @return 权限组实体
     */
    public PermissionGroup findById(Long id) {
        return permissionGroupMapper.selectById(id);
    }

    /**
     * 更新权限组基本信息
     *
     * @param basicInfoDTO 基本信息
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateBasicInfo(PermissionGroupBasicInfoDTO basicInfoDTO) {
        Long id = basicInfoDTO.getId();

        // 检查权限组是否存在
        PermissionGroup existingGroup = permissionGroupMapper.selectById(id);
        if (existingGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 校验编码是否重复
        Long codeCount = permissionGroupMapper.countByGroupCode(basicInfoDTO.getGroupCode(), id);
        if (codeCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.code.exists"));
        }

        // 校验名称是否重复
        Long nameCount = permissionGroupMapper.countByGroupName(basicInfoDTO.getGroupName(), id);
        if (nameCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.name.exists"));
        }

        // 更新基本信息
        existingGroup.setGroupCode(basicInfoDTO.getGroupCode());
        existingGroup.setGroupName(basicInfoDTO.getGroupName());
        existingGroup.setDescription(basicInfoDTO.getDescription());
        if (basicInfoDTO.getStatus() != null) {
            existingGroup.setStatus(basicInfoDTO.getStatus());
        }
        existingGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        existingGroup.setUpdateTime(new Date());

        permissionGroupMapper.updateById(existingGroup);

        logger.info("更新权限组基本信息成功: id={}", id);
    }

    /**
     * 更新功能权限
     * 按照resource的粒度进行更新，只更新传入的资源权限，不影响其他资源权限
     *
     * @param updateDTO 功能权限配置
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateResourcePermissions(UpdateResourcePermissionDTO updateDTO) {
        // 参数校验
        if (updateDTO == null || updateDTO.getPermissionGroupId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("param.invalid"));
        }

        Long permissionGroupId = updateDTO.getPermissionGroupId();
        List<PermissionResourceDTO> resourcePermissions = updateDTO.getResourcePermissions();

        // 检查权限组是否存在
        PermissionGroup existingGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (existingGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 过滤有效的资源权限配置
        List<PermissionResourceDTO> validResourcePermissions = resourcePermissions.stream()
                .filter(dto -> dto != null && dto.getResourceId() != null)
                .collect(Collectors.toList());

        if (ListUtil.isEmpty(validResourcePermissions)) {
            logger.info("没有有效的资源权限配置需要更新: permissionGroupId={}", permissionGroupId);
            return;
        }

        // 批量查询资源信息，避免N+1查询
        List<Long> resourceIds = validResourcePermissions.stream()
                .map(PermissionResourceDTO::getResourceId)
                .distinct()
                .collect(Collectors.toList());

        List<SsResource> ssResources = ssResourceMapper.selectBatchIds(resourceIds);
        Map<Long, SsResource> resourceMap = ssResources.stream()
                .collect(Collectors.toMap(SsResource::getResourceId, resource -> resource));

        // 处理权限更新
        Set<Long> allAffectedResourceIds = processResourcePermissions(permissionGroupId, validResourcePermissions, resourceMap);

        // 更新权限组的更新时间
        updatePermissionGroupTimestamp(existingGroup);

        // 同步Redis缓存
        syncRedisCache(allAffectedResourceIds);

        logger.info("更新功能权限成功: permissionGroupId={}, resourceCount={}",
                permissionGroupId, validResourcePermissions.size());
    }

    /**
     * 处理资源权限更新逻辑
     *
     * @param permissionGroupId 权限组ID
     * @param resourcePermissions 资源权限配置列表
     * @param resourceMap 资源信息映射
     * @return 受影响的所有资源ID集合
     */
    private Set<Long> processResourcePermissions(Long permissionGroupId,
                                                  List<PermissionResourceDTO> resourcePermissions,
                                                  Map<Long, SsResource> resourceMap) {
        Set<Long> allAffectedResourceIds = new HashSet<>();
        Date now = new Date();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        // 分离视图资源和其他资源处理
        List<PermissionResourceDTO> viewResources = new ArrayList<>();
        List<PermissionResourceDTO> objectResources = new ArrayList<>();

        for (PermissionResourceDTO resourceDTO : resourcePermissions) {
            SsResource ssResource = resourceMap.get(resourceDTO.getResourceId());
            if (ssResource != null && "VIEW".equals(ssResource.getResourceBizType())) {
                viewResources.add(resourceDTO);
            } else {
                objectResources.add(resourceDTO);
            }
        }

        // 处理视图资源
        Set<Long> viewAffectedIds = processViewResources(permissionGroupId, viewResources, now, currentUserId);
        allAffectedResourceIds.addAll(viewAffectedIds);

        // 处理普通资源
        Set<Long> objectAffectedIds = processObjectResources(permissionGroupId, objectResources);
        allAffectedResourceIds.addAll(objectAffectedIds);

        return allAffectedResourceIds;
    }

    /**
     * 处理视图资源权限
     */
    private Set<Long> processViewResources(Long permissionGroupId, List<PermissionResourceDTO> viewResources,
                                           Date now, Long currentUserId) {
        Set<Long> affectedResourceIds = new HashSet<>();
        Set<Long> allRelObjIds = new HashSet<>();

        // 第一步：收集所有视图资源及其关联的实体资源
        for (PermissionResourceDTO resourceDTO : viewResources) {
            // 删除视图资源本身的权限
            permissionGroupResourceMapper.deleteByPermissionGroupIdAndResourceId(permissionGroupId, resourceDTO.getResourceId());
            affectedResourceIds.add(resourceDTO.getResourceId());

            // 查询视图关联的实体资源
            List<SsResourceRelDetailDTO> relDetails = ssResourceRelDetailMapper.findByViewResourceId(resourceDTO.getResourceId());
            if (ListUtil.isNotEmpty(relDetails)) {
                List<Long> relObjIds = relDetails.stream()
                        .map(SsResourceRelDetailDTO::getRelResourceId)
                        .collect(Collectors.toList());
                allRelObjIds.addAll(relObjIds);
            }

            // 如果视图资源本身有权限类型，则保存视图资源的权限
            if (ListUtil.isNotEmpty(resourceDTO.getPermissionTypes())) {
                List<PermissionResourceDTO> singleResourceList = Collections.singletonList(resourceDTO);
                saveResourcePermissions(permissionGroupId, singleResourceList);
            }
        }

        // 第二步：批量删除所有关联资源的VIEW_REL_OBJECT权限
        if (ListUtil.isNotEmpty(allRelObjIds)) {
            LambdaQueryWrapper<PermissionGroupResource> deleteQueryWrapper = new LambdaQueryWrapper<PermissionGroupResource>()
                    .eq(PermissionGroupResource::getPermissionGroupId, permissionGroupId)
                    .in(PermissionGroupResource::getResourceId, allRelObjIds)
                    .eq(PermissionGroupResource::getResourceType, "VIEW_REL_OBJECT");
            permissionGroupResourceMapper.delete(deleteQueryWrapper);

            // 批量插入关联资源的权限（去重后的）
            List<PermissionGroupResource> insertList = allRelObjIds.stream()
                    .map(objId -> {
                        PermissionGroupResource resource = new PermissionGroupResource();
                        resource.setId(SequenceService.nextSnowId());
                        resource.setPermissionGroupId(permissionGroupId);
                        resource.setResourceId(objId);
                        resource.setResourceType("VIEW_REL_OBJECT");
                        resource.setPermissionType("[]");
                        resource.setCreateBy(currentUserId);
                        resource.setCreateTime(now);
                        return resource;
                    })
                    .collect(Collectors.toList());

            if (ListUtil.isNotEmpty(insertList)) {
                permissionGroupResourceMapper.batchInsert(insertList);
            }

            affectedResourceIds.addAll(allRelObjIds);
        }

        return affectedResourceIds;
    }

    /**
     * 处理视图资源删除（级联删除关联的实体资源权限）
     *
     * @param permissionGroupId 权限组ID
     * @param viewResourceIds 视图资源ID列表
     * @return 受影响的所有资源ID集合
     */
    private Set<Long> processViewResourceDeletion(Long permissionGroupId, List<Long> viewResourceIds) {
        Set<Long> affectedResourceIds = new HashSet<>();
        Set<Long> allRelObjIds = new HashSet<>();

        // 第一步：收集所有需要删除的视图资源及其关联的实体资源
        for (Long viewResourceId : viewResourceIds) {
            // 删除视图资源本身的权限（包括所有类型的权限）
            permissionGroupResourceMapper.deleteByPermissionGroupIdAndResourceId(permissionGroupId, viewResourceId);
            affectedResourceIds.add(viewResourceId);

            // 查询视图关联的实体资源
            List<SsResourceRelDetailDTO> relDetails = ssResourceRelDetailMapper.findByViewResourceId(viewResourceId);
            if (ListUtil.isNotEmpty(relDetails)) {
                List<Long> relObjIds = relDetails.stream()
                        .map(SsResourceRelDetailDTO::getRelResourceId)
                        .collect(Collectors.toList());
                allRelObjIds.addAll(relObjIds);
            }
        }

        // 第二步：批量删除所有关联资源的VIEW_REL_OBJECT类型的权限
        if (ListUtil.isNotEmpty(allRelObjIds)) {
            LambdaQueryWrapper<PermissionGroupResource> queryWrapper = new LambdaQueryWrapper<PermissionGroupResource>()
                    .eq(PermissionGroupResource::getPermissionGroupId, permissionGroupId)
                    .in(PermissionGroupResource::getResourceId, allRelObjIds)
                    .eq(PermissionGroupResource::getResourceType, "VIEW_REL_OBJECT");

            List<PermissionGroupResource> viewRelObjects = permissionGroupResourceMapper.selectList(queryWrapper);
            if (ListUtil.isNotEmpty(viewRelObjects)) {
                List<Long> idsToDelete = viewRelObjects.stream()
                        .map(PermissionGroupResource::getId)
                        .collect(Collectors.toList());
                permissionGroupResourceMapper.batchDeleteByIds(idsToDelete);
                affectedResourceIds.addAll(allRelObjIds);
            }
        }

        return affectedResourceIds;
    }

    /**
     * 处理普通对象资源权限
     */
    private Set<Long> processObjectResources(Long permissionGroupId, List<PermissionResourceDTO> objectResources) {
        Set<Long> affectedResourceIds = new HashSet<>();

        for (PermissionResourceDTO resourceDTO : objectResources) {
            // 删除现有权限
            permissionGroupResourceMapper.deleteByPermissionGroupIdAndResourceId(permissionGroupId, resourceDTO.getResourceId());

            // 保存新权限
            if (ListUtil.isNotEmpty(resourceDTO.getPermissionTypes())) {
                List<PermissionResourceDTO> singleResourceList = Collections.singletonList(resourceDTO);
                saveResourcePermissions(permissionGroupId, singleResourceList);
            }

            affectedResourceIds.add(resourceDTO.getResourceId());
        }

        return affectedResourceIds;
    }

    /**
     * 更新权限组时间戳
     */
    private void updatePermissionGroupTimestamp(PermissionGroup permissionGroup) {
        permissionGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        permissionGroup.setUpdateTime(new Date());
        permissionGroupMapper.updateById(permissionGroup);
    }

    /**
     * 同步Redis缓存
     */
    private void syncRedisCache(Set<Long> affectedResourceIds) {
        if (CollectionUtils.isEmpty(affectedResourceIds)) {
            return;
        }

        // 只查询受影响的资源权限信息
        LambdaQueryWrapper<PermissionGroupResource> queryWrapper = new LambdaQueryWrapper<PermissionGroupResource>()
                .in(PermissionGroupResource::getResourceId, affectedResourceIds);

        List<PermissionGroupResource> permissionGroupResources = permissionGroupResourceMapper.selectList(queryWrapper);

        if (CollectionUtils.isEmpty(permissionGroupResources)) {
            return;
        }

        // 批量更新Redis缓存
        Map<Long, List<PermissionGroupResource>> groupedResources = permissionGroupResources.stream()
                .collect(Collectors.groupingBy(PermissionGroupResource::getResourceId));

        List<Map<String, Object>> resourcePermissionList = groupedResources.entrySet().stream()
                .map(entry -> {
                    Map<String, Object> resourceMap = new HashMap<>();
                    Long resourceId = entry.getKey();
                    List<PermissionGroupResource> resources = entry.getValue();

                    resourceMap.put("resourceId", String.valueOf(resourceId));
                    resourceMap.put("resourceType", resources.get(0).getResourceType());
                    resourceMap.put("permissionGroupIds", resources.stream()
                            .map(resource -> String.valueOf(resource.getPermissionGroupId()))
                            .collect(Collectors.toList()));

                    return resourceMap;
                })
                .collect(Collectors.toList());

        // 使用批量操作更新Redis
        for (Map<String, Object> resourceMap : resourcePermissionList) {
            RedisUtil.setString("PER_GROUPS_OBJECT_" + resourceMap.get("resourceId"), JSON.toJSONString(resourceMap));
        }
    }

    /**
     * 删除操作后的Redis缓存同步
     * 对于还有权限记录的资源更新缓存，对于没有权限记录的资源删除缓存
     */
    private void syncRedisCacheAfterDeletion(Set<Long> affectedResourceIds) {
        if (CollectionUtils.isEmpty(affectedResourceIds)) {
            return;
        }

        // 查询受影响资源当前的权限信息
        LambdaQueryWrapper<PermissionGroupResource> queryWrapper = new LambdaQueryWrapper<PermissionGroupResource>()
                .in(PermissionGroupResource::getResourceId, affectedResourceIds);

        List<PermissionGroupResource> permissionGroupResources = permissionGroupResourceMapper.selectList(queryWrapper);

        // 按资源ID分组
        Map<Long, List<PermissionGroupResource>> groupedResources = permissionGroupResources.stream()
                .collect(Collectors.groupingBy(PermissionGroupResource::getResourceId));

        // 处理每个受影响的资源
        for (Long resourceId : affectedResourceIds) {
            List<PermissionGroupResource> resources = groupedResources.get(resourceId);

            if (ListUtil.isNotEmpty(resources)) {
                // 还有权限记录，更新Redis缓存
                Map<String, Object> resourceMap = new HashMap<>();
                resourceMap.put("resourceId", String.valueOf(resourceId));
                resourceMap.put("resourceType", resources.get(0).getResourceType());
                resourceMap.put("permissionGroupIds", resources.stream()
                        .map(resource -> String.valueOf(resource.getPermissionGroupId()))
                        .collect(Collectors.toList()));

                RedisUtil.setString("PER_GROUPS_OBJECT_" + resourceId, JSON.toJSONString(resourceMap));
            } else {
                // 没有权限记录了，删除Redis缓存
                RedisUtil.removeKey("PER_GROUPS_OBJECT_" + resourceId);
            }
        }
    }

    /**
     * 更新数据权限
     *
     * @param updateDTO 数据权限配置
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateDataPermission(UpdateDataPermissionDTO updateDTO) {
        Long permissionGroupId = updateDTO.getPermissionGroupId();

        // 检查权限组是否存在
        PermissionGroup existingGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (existingGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 先删除原有数据权限
        defaultDataPermissionMapper.deleteByPermissionGroupId(permissionGroupId);

        // 保存新的数据权限
        DataPermissionDTO dataPermissionDTO = new DataPermissionDTO();
        dataPermissionDTO.setDataScopeType(updateDTO.getDataScopeType());
        dataPermissionDTO.setDataScopeConfig(updateDTO.getDataScopeConfig());
        dataPermissionDTO.setFieldPermissions(updateDTO.getFieldPermissions());
        dataPermissionDTO.setRowPermissions(updateDTO.getRowPermissions());
        saveDataPermission(permissionGroupId, dataPermissionDTO);

        // 更新权限组的更新时间
        existingGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        existingGroup.setUpdateTime(new Date());
        permissionGroupMapper.updateById(existingGroup);

        logger.info("更新数据权限成功: permissionGroupId={}", permissionGroupId);
    }

    /**
     * 批量删除授权对象
     *
     * @param ids 关联ID列表
     */
    @Transactional(rollbackFor = Exception.class)
    public void batchDeleteAuthorizedObjects(List<Long> ids) {
        if (ListUtil.isEmpty(ids)) {
            return;
        }

        permissionGroupAuthorizedObjectMapper.batchDeleteByIds(ids);
        logger.info("批量删除授权对象成功: count={}", ids.size());
    }

    /**
     * 分页查询权限组授权用户列表（去重）
     * @param queryQO 查询条件
     * @return 授权用户分页列表
     */
    public Page<AuthorizedUserVO> queryAuthorizedUserPage(AuthorizedUserQueryQO queryQO) {
        Page<AuthorizedUserVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        List<AuthorizedUserVO> records = permissionGroupAuthorizedObjectMapper.selectAuthorizedUserPage(page, queryQO).getRecords();
        page.setRecords(records);
        return page;
    }

    /**
     * 分页查询可用授权对象
     *
     * @param queryQO 查询条件
     * @return 可用授权对象分页列表
     */
    public Page<AvailableObjectVO> queryAvailableObjectPage(AvailableObjectQueryQO queryQO) {
        Page<AvailableObjectVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        String objectType = queryQO.getObjectType();

        List<AvailableObjectVO> records;
        if ("user".equals(objectType)) {
            records = availableObjectMapper.selectAvailableUsers(page, queryQO).getRecords();
        } else if ("org".equals(objectType)) {
            records = availableObjectMapper.selectAvailableOrganizations(page, queryQO).getRecords();
        } else {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.object.type.unsupported", objectType));
        }
        page.setRecords(records);
        return page;
    }

    /**
     * 分页查询权限组授权资源列表
     *
     * @param queryQO 查询条件
     * @return 授权资源分页列表
     */
    public Page<PermissionResourceVO> queryResourcePermissionPage(ResourcePermissionQueryQO queryQO) {
        Page<PermissionResourceVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());
        List<PermissionResourceVO> records = permissionGroupResourceMapper.selectResourcePermissionPage(page, queryQO).getRecords();
        page.setRecords(records);
        return page;
    }

    /**
     * 查询指定资源的所有属性权限配置
     *
     * @param resourceId 资源ID
     * @return 资源属性权限列表
     */
    public List<ResourceAttributePermissionVO> queryResourceAttributePermissions(Long resourceId) {
        return permissionGroupResourceAttributeMapper.selectByResourceId(resourceId);
    }

    /**
     * 查询指定资源的属性权限列表
     *
     * @param resourceId 资源ID
     * @return 资源属性权限列表
     */
    public List<ResourceAttributePermissionVO> queryResourceAttributePermissionsByResource(Long resourceId) {
        return permissionGroupResourceAttributeMapper.selectByResourceId(resourceId);
    }

    /**
     * 更新资源属性权限
     * 按照"资源"的粒度进行操作，只更新指定资源的属性权限
     * 记录资源属性与数据权限范围的映射关系
     *
     * @param updateDTO 资源属性权限配置
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateResourceAttributePermissions(UpdateResourceAttributePermissionDTO updateDTO) {
        Long resourceId = updateDTO.getResourceId();

        // 先删除该资源的所有属性权限（按资源粒度删除）
        permissionGroupResourceAttributeMapper.deleteByResourceId(resourceId);

        // 保存新的资源属性权限
        saveResourceAttributePermissions(resourceId, updateDTO.getAttributePermissions());

        logger.info("更新资源属性权限成功: resourceId={}", resourceId);
    }

    /**
     * 保存资源属性权限
     * 记录资源属性与数据权限范围的映射关系
     *
     * @param resourceId 资源ID
     * @param attributePermissions 资源属性权限列表
     */
    private void saveResourceAttributePermissions(Long resourceId,
            List<ResourceAttributePermissionDTO> attributePermissions) {
        if (ListUtil.isEmpty(attributePermissions)) {
            return;
        }

        List<PermissionGroupResourceAttribute> insertList = new ArrayList<>();
        Date now = new Date();
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        for (ResourceAttributePermissionDTO dto : attributePermissions) {
            PermissionGroupResourceAttribute attribute = new PermissionGroupResourceAttribute();
            attribute.setId(SequenceService.nextSnowId());
            attribute.setResourceId(resourceId);
            attribute.setResourceAttributeId(dto.getResourceAttributeId());
            attribute.setDataScopeType(dto.getDataScopeType());
            attribute.setCreateBy(currentUserId);
            attribute.setCreateTime(now);

            insertList.add(attribute);
        }

        if (ListUtil.isNotEmpty(insertList)) {
            permissionGroupResourceAttributeMapper.batchInsert(insertList);
        }
    }

    /**
     * 批量删除权限组资源
     * 根据权限组ID和资源ID列表批量删除该权限组下指定资源的所有权限
     * 对于视图资源，会级联删除其关联的实体资源权限
     *
     * @param permissionGroupId 权限组ID
     * @param resourceIds 资源ID列表
     */
    @Transactional(rollbackFor = Exception.class)
    public void batchDeletePermissionGroupResources(Long permissionGroupId, List<Long> resourceIds) {
        if (permissionGroupId == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.id.not.null"));
        }

        if (ListUtil.isEmpty(resourceIds)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.resource.id.list.not.empty"));
        }

        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 批量查询资源信息，区分视图资源和普通资源
        List<SsResource> ssResources = ssResourceMapper.selectBatchIds(resourceIds);
        Map<Long, SsResource> resourceMap = ssResources.stream()
                .collect(Collectors.toMap(SsResource::getResourceId, resource -> resource));

        // 分离视图资源和其他资源
        List<Long> viewResourceIds = new ArrayList<>();
        List<Long> objectResourceIds = new ArrayList<>();

        for (Long resourceId : resourceIds) {
            SsResource ssResource = resourceMap.get(resourceId);
            if (ssResource != null && "VIEW".equals(ssResource.getResourceBizType())) {
                viewResourceIds.add(resourceId);
            } else {
                objectResourceIds.add(resourceId);
            }
        }

        int totalDeleteCount = 0;

        // 处理普通对象资源删除
        if (ListUtil.isNotEmpty(objectResourceIds)) {
            int deleteCount = permissionGroupResourceMapper.batchDeleteByPermissionGroupIdAndResourceIds(
                    permissionGroupId, objectResourceIds);
            totalDeleteCount += deleteCount;
        }

        // 处理视图资源删除（级联删除关联的实体资源）
        Set<Long> allAffectedResourceIds = new HashSet<>();
        if (ListUtil.isNotEmpty(viewResourceIds)) {
            Set<Long> viewAffectedIds = processViewResourceDeletion(permissionGroupId, viewResourceIds);
            allAffectedResourceIds.addAll(viewAffectedIds);
        }
        // 添加普通资源ID到受影响资源集合
        allAffectedResourceIds.addAll(objectResourceIds);

        // 更新权限组时间戳
        updatePermissionGroupTimestamp(permissionGroup);

        // 同步Redis缓存
        syncRedisCacheAfterDeletion(allAffectedResourceIds);

        logger.info("批量删除权限组资源成功: permissionGroupId={}, resourceCount={}, deleteCount={}",
                permissionGroupId, resourceIds.size(), totalDeleteCount);
    }

    /**
     * 查询权限组和目录联合信息
     * 根据查询条件同时返回符合条件的目录列表和权限组列表（含目录信息）
     *
     * @param queryCondition 查询条件（模糊匹配目录名称和权限组名称）
     * @param userId 用户ID（可选，用于过滤特定用户的数据）
     * @return 权限组和目录联合查询结果
     */
    public PermissionGroupAndCatalogResultVO queryPermissionGroupAndCatalog(String queryCondition, Long userId) {
        PermissionGroupAndCatalogResultVO result = new PermissionGroupAndCatalogResultVO();

        // 1. 查询目录列表（根据目录名称模糊匹配）
        List<CatalogSimpleVO> catalogList = permissionGroupCategoryMapper.selectCatalogByCatalogName(
                queryCondition, userId);
        result.setCatalogList(catalogList);

        // 2. 查询权限组列表（根据权限组名称模糊匹配，包含目录信息）
        List<PermissionGroupWithCatalogVO> permissionGroupList = permissionGroupMapper
                .selectPermissionGroupWithCatalogByGroupName(queryCondition, userId);

        result.setBiPrivGroupInfoList(permissionGroupList);

        logger.info("查询权限组和目录联合信息成功: catalogCount={}, groupCount={}",
                catalogList != null ? catalogList.size() : 0,
                permissionGroupList != null ? permissionGroupList.size() : 0);

        return result;
    }

    /**
     * 查询权限组授权对象数据权限列表
     *
     * @param permissionGroupId 权限组ID
     * @return 授权对象数据权限列表
     */
    public List<AuthorizedObjectDataPermissionVO> queryAuthorizedObjectDataPermissions(Long permissionGroupId) {
        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }
        List<AuthorizedObjectDataPermissionVO> result = authorizedObjectDataPermissionMapper.selectByPermissionGroupId(permissionGroupId);
        return result;
    }

    /**
     * 查询单个用户的数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     * @return 用户数据权限
     */
    public AuthorizedObjectDataPermissionVO getUserDataPermission(Long permissionGroupId, Long userId) {
        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        AuthorizedObjectDataPermissionVO result = authorizedObjectDataPermissionMapper.selectByPermissionGroupIdAndUserId(
                permissionGroupId, userId);

        return result;
    }

    /**
     * 更新单个用户的数据权限
     *
     * @param updateDTO 更新数据权限配置
     */
    @Transactional(rollbackFor = Exception.class)
    public void updateAuthorizedObjectDataPermission(UpdateAuthorizedObjectDataPermissionDTO updateDTO) {
        Long permissionGroupId = updateDTO.getPermissionGroupId();
        Long userId = updateDTO.getUserId();

        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 检查用户是否属于该权限组的授权对象
        boolean isUserAuthorized = checkUserBelongsToPermissionGroup(permissionGroupId, userId);
        if (!isUserAuthorized) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.user.not.authorized.object"));
        }

        // 先删除该用户在权限组下的所有数据权限
        authorizedObjectDataPermissionMapper.deleteByPermissionGroupIdAndUserId(
                permissionGroupId, userId);
        supPermissionsInfo(updateDTO);
        // 保存新的数据权限（全量更新，只创建一条记录）
        AuthorizedObjectDataPermission dataPermission = new AuthorizedObjectDataPermission();
        dataPermission.setId(SequenceService.nextSnowId());
        dataPermission.setPermissionGroupId(permissionGroupId);
        dataPermission.setUserId(userId);
        dataPermission.setPermissions(JSON.toJSONString(updateDTO.getPermissions()));
        dataPermission.setStatus("active");
        dataPermission.setCreateBy(CurrentUserHolder.getCurrentUserId());
        dataPermission.setCreateTime(new Date());

        authorizedObjectDataPermissionMapper.insert(dataPermission);

        // 更新权限组的更新时间
        permissionGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        permissionGroup.setUpdateTime(new Date());
        permissionGroupMapper.updateById(permissionGroup);

        logger.info("更新用户数据权限成功: permissionGroupId={}, userId={}",
                permissionGroupId, userId);
    }


    private void supPermissionsInfo(UpdateAuthorizedObjectDataPermissionDTO updateDTO) {
        List<UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem> permissions = updateDTO.getPermissions();
        if (CollectionUtils.isEmpty(permissions)) {
            return;
        }

        for (UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem permission : permissions) {
            String dataScopeType = permission.getDataScopeType();
            List<String> objList = permission.getObjList();
            if (CollectionUtils.isEmpty(objList)) {
                continue;
            }

            LinkedList<Map<String, String>> objInfoList = buildObjInfoList(dataScopeType, objList);
            if (CollectionUtils.isNotEmpty(objInfoList)) {
                permission.setObjInfoList(objInfoList);
            }
        }
    }

    /**
     * 根据数据范围类型构建对象信息列表
     *
     * @param dataScopeType 数据范围类型
     * @param objList 对象ID列表
     * @return 对象信息列表
     */
    private LinkedList<Map<String, String>> buildObjInfoList(String dataScopeType, List<String> objList) {
        LinkedList<Map<String, String>> objInfoList = new LinkedList<>();

        switch (dataScopeType) {
            case "user":
                buildUserObjInfoList(objList, objInfoList);
                break;
            case "org":
                buildOrgObjInfoList(objList, objInfoList);
                break;
            case "position":
                buildPositionObjInfoList(objList, objInfoList);
                break;
            case "station":
                buildStationObjInfoList(objList, objInfoList);
                break;
            default:
                // 对于不支持的数据范围类型，返回空列表
                break;
        }

        return objInfoList;
    }

    /**
     * 构建用户对象信息列表
     */
    private void buildUserObjInfoList(List<String> objList, LinkedList<Map<String, String>> objInfoList) {
        for (String userId : objList) {
            ShareBfmUser userInfo = ShareCacheUtil.getShareBfmUser(Long.parseLong(userId));
            if (userInfo != null) {
                Map<String, String> objInfo = new HashMap<>();
                objInfo.put("objId", userId);
                objInfo.put("objType", "user");
                objInfo.put("objName", userInfo.getUserName());
                objInfoList.add(objInfo);
            }
        }
    }

    /**
     * 构建组织对象信息列表
     */
    private void buildOrgObjInfoList(List<String> objList, LinkedList<Map<String, String>> objInfoList) {
        for (String orgId : objList) {
            Organization organization = ShareCacheUtil.getShareOrganization(Long.parseLong(orgId));
            if (organization != null) {
                Map<String, String> objInfo = new HashMap<>();
                objInfo.put("objId", orgId);
                objInfo.put("objType", "org");
                objInfo.put("objName", organization.getOrgName());
                objInfoList.add(objInfo);
            }
        }
    }

    /**
     * 构建岗位对象信息列表
     */
    private void buildPositionObjInfoList(List<String> objList, LinkedList<Map<String, String>> objInfoList) {
        for (String positionId : objList) {
            Position position = ShareCacheUtil.getSharePosition(Long.parseLong(positionId));
            if (position != null) {
                Map<String, String> objInfo = new HashMap<>();
                objInfo.put("objId", positionId);
                objInfo.put("objType", "position");
                objInfo.put("objName", position.getPositionName());
                objInfoList.add(objInfo);
            }
        }
    }

    /**
     * 构建驻地对象信息列表
     */
    private void buildStationObjInfoList(List<String> objList, LinkedList<Map<String, String>> objInfoList) {
        for (String stationId : objList) {
            UserStation station = ShareCacheUtil.getShareStation(Long.parseLong(stationId));
            if (station != null) {
                Map<String, String> objInfo = new HashMap<>();
                objInfo.put("objId", stationId);
                objInfo.put("objType", "station");
                objInfo.put("objName", station.getStationName());
                objInfoList.add(objInfo);
            }
        }
    }



    /**
     * 检查用户是否属于权限组的授权对象
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     * @return true-属于，false-不属于
     */
    private boolean checkUserBelongsToPermissionGroup(Long permissionGroupId, Long userId) {
        // 直接检查用户是否在权限组的授权对象中（用户类型）
        Long directUserCount = permissionGroupAuthorizedObjectMapper.countByObject(permissionGroupId, "user", userId);
        if (directUserCount > 0) {
            return true;
        }

        // 检查用户是否通过组织、岗位等间接属于权限组
        // 这里可以复用现有的查询逻辑或者创建一个简单的检查方法
        // 为了简化，我们可以查询权限组授权用户列表，看看是否包含该用户
        AuthorizedUserQueryQO queryQO = new AuthorizedUserQueryQO();
        queryQO.setPermissionGroupId(permissionGroupId);
//        queryQO.setUserId(userId);
        // 创建分页对象，每页1条即可，因为只需要检查是否存在
        Page<AuthorizedUserVO> page = new Page<>(1, 1);
        List<AuthorizedUserVO> authorizedUsers = permissionGroupAuthorizedObjectMapper.selectAuthorizedUserPage(page, queryQO).getRecords();
        return !authorizedUsers.isEmpty();
    }

    /**
     * 删除单个用户的数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void deleteAuthorizedObjectDataPermission(Long permissionGroupId, Long userId) {
        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 删除该用户的数据权限
        int deletedCount = authorizedObjectDataPermissionMapper.deleteByPermissionGroupIdAndUserId(
                permissionGroupId, userId);

        if (deletedCount > 0) {
            // 更新权限组的更新时间
            permissionGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            permissionGroup.setUpdateTime(new Date());
            permissionGroupMapper.updateById(permissionGroup);
        }

        logger.info("删除用户数据权限成功: permissionGroupId={}, userId={}, deletedCount={}",
                permissionGroupId, userId, deletedCount);
    }

    /**
     * 批量删除用户的数据权限
     *
     * @param permissionGroupId 权限组ID
     * @param userIds 用户ID列表
     */
    @Transactional(rollbackFor = Exception.class)
    public void batchDeleteUserDataPermissions(Long permissionGroupId, List<Long> userIds) {
        if (ListUtil.isEmpty(userIds)) {
            return;
        }

        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        int deleteCount = authorizedObjectDataPermissionMapper.batchDeleteByPermissionGroupIdAndUserIds(
                permissionGroupId, userIds);

        if (deleteCount > 0) {
            // 更新权限组的更新时间
            permissionGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
            permissionGroup.setUpdateTime(new Date());
            permissionGroupMapper.updateById(permissionGroup);
        }

        logger.info("批量删除授权对象数据权限成功: permissionGroupId={}, deleteCount={}",
                permissionGroupId, deleteCount);
    }

    /**
     * 重置用户的数据权限（删除自定义权限，恢复使用默认权限）
     *
     * @param permissionGroupId 权限组ID
     * @param userId 用户ID
     */
    @Transactional(rollbackFor = Exception.class)
    public void resetUserDataPermission(Long permissionGroupId, Long userId) {
        // 检查权限组是否存在
        PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
        if (permissionGroup == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("permission.group.not.exist"));
        }

        // 删除用户的数据权限配置，使其使用权限组默认数据权限
        authorizedObjectDataPermissionMapper.deleteByPermissionGroupIdAndUserId(
                permissionGroupId, userId);

        // 更新权限组的更新时间
        permissionGroup.setUpdateBy(CurrentUserHolder.getCurrentUserId());
        permissionGroup.setUpdateTime(new Date());
        permissionGroupMapper.updateById(permissionGroup);

        logger.info("重置用户数据权限成功: permissionGroupId={}, userId={}",
                permissionGroupId, userId);
    }

    /**
     * 检查当前用户是否有访问指定数据实例列表的权限
     *
     * @param permissionGroupIds 权限组ID列表
     * @param dimensionType 维度类型：user-用户, org-组织, position-岗位, station-驻地
     * @param objIds 数据实例ID列表
     * @return 检查结果，包含可访问和不可访问的数据实例ID列表
     */
    public DimensionListPermissionVO checkDimensionListPermission(List<Long> permissionGroupIds, String dimensionType, List<String> objIds) {
        Long currentUserId = CurrentUserHolder.getCurrentUserId();

        // 对入参 objIds 进行去重处理，避免重复数据影响权限检查结果
        objIds = objIds.stream().distinct().collect(Collectors.toList());

        if (currentUserId == null || ListUtil.isEmpty(permissionGroupIds) || ListUtil.isEmpty(objIds)) {
            logger.warn("当前用户未登录，无法检查权限");
            return new DimensionListPermissionVO(false, dimensionType, new ArrayList<>(), objIds.stream().map(Object::toString).collect(Collectors.toList()));
        }

        List<String> accessibleObjIds = new ArrayList<>();
        List<String> inaccessibleObjIds = new ArrayList<>();
//        if (dimensionType.equals("user")) {
//            queryObjIdList.add(currentUserId);2
//        }
        List<Long> queryObjIdList = objIds.stream().map(Long::valueOf).collect(Collectors.toList());
        AuthorizedUserQueryQO queryQO = new AuthorizedUserQueryQO();
        queryQO.setCurrentUserId(currentUserId);
        queryQO.setPermissionGroupIds(permissionGroupIds);
        queryQO.setDimensionType(dimensionType);
        queryQO.setObjIdList(queryObjIdList);
        if ("user".equals(dimensionType)) {
            queryQO.setUserCodeList(objIds);
        }

        Page<AuthorizedUserVO> page = new Page<>(queryQO.getPageIndex(), queryQO.getPageSize());


        // 根据维度类型和数据权限范围检查权限
        if ("user".equals(dimensionType)) {
            // 用户维度：需要考虑默认数据权限范围
            checkUserDimensionPermission(permissionGroupIds, objIds, queryQO, page, accessibleObjIds, inaccessibleObjIds, currentUserId);
        } else {
            // 其他维度：只能看除了self之外的数据范围
            checkNonUserDimensionPermission(permissionGroupIds, dimensionType, objIds, accessibleObjIds, inaccessibleObjIds);
        }

        // 检查本人默认数据范围权限（本人、组织、岗位、驻地）
        checkCurrentUserDefaultDataScope(objIds, dimensionType, accessibleObjIds, inaccessibleObjIds);

        // 查询当前用户在这些权限组下面的权限
        ArrayList<Long> userScopeOrgList = new ArrayList<>();
        ArrayList<Long> userScopeUserList = new ArrayList<>();
        ArrayList<Long> userScopePositionList = new ArrayList<>();

        // 检查扩展权限：用户扩展权限可以覆盖默认数据权限范围的结果
        // 无论默认权限检查结果如何，都需要检查用户的扩展权限配置
        if (!objIds.isEmpty()) {
            for (Long permissionGroupId : permissionGroupIds) {
                AuthorizedObjectDataPermissionVO userExtendedPermission = authorizedObjectDataPermissionMapper.selectByPermissionGroupIdAndUserId(permissionGroupId, currentUserId);
                if (userExtendedPermission == null) {
                    continue;
                }
                List<UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem> permissionItems =
                        JSON.parseArray(userExtendedPermission.getPermissions(),
                                UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem.class);
                for (UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem permissionItem : permissionItems) {
                    List<String> objList = permissionItem.getObjList();
                    String dataScopeType = permissionItem.getDataScopeType();
                    if (CollectionUtils.isNotEmpty(objList)) {
                        switch (dataScopeType) {
                            case "user":
                                userScopeUserList.addAll(objList.stream().map(Long::parseLong).toList());
                                break;
                            case "org":
                                userScopeOrgList.addAll(objList.stream().map(Long::parseLong).toList());
                                break;
                            case "position":
                                userScopePositionList.addAll(objList.stream().map(Long::parseLong).toList());
                                break;
                            default:
                                break;
                            }
                        }
                    }

            }

            if (CollectionUtils.isNotEmpty(userScopeOrgList) || CollectionUtils.isNotEmpty(userScopePositionList) || CollectionUtils.isNotEmpty(userScopeUserList)) {
                processUserExtendedPermissions(dimensionType, queryQO, userScopeOrgList, userScopePositionList,
                    userScopeUserList, objIds, queryObjIdList, accessibleObjIds, inaccessibleObjIds);
            }
        }

        // 确保所有输入的对象都被正确分类：如果某个对象既不在可访问列表也不在不可访问列表中，将其添加到不可访问列表
        for (String objId : objIds) {
            if (!accessibleObjIds.contains(objId) && !inaccessibleObjIds.contains(objId)) {
                inaccessibleObjIds.add(objId);
            }
        }

        // 判断是否有权限：只有当不可访问列表为空，且可访问列表包含所有输入对象时，才认为有全部权限
        boolean hasAllPermission = inaccessibleObjIds.isEmpty() && accessibleObjIds.size() == objIds.size() &&
                                  new HashSet<>(accessibleObjIds).containsAll(objIds);
        return new DimensionListPermissionVO(hasAllPermission, dimensionType, accessibleObjIds, inaccessibleObjIds);
    }

    /**
     * 检查本人默认数据范围权限（本人、组织、岗位、驻地）
     * 当前用户基于自己的身份默认拥有的数据访问权限
     *
     * @param objIds 需要检查权限的对象ID列表
     * @param dimensionType 维度类型
     * @param currentUserId 当前用户ID
     * @param accessibleObjIds 可访问的对象ID列表
     * @param inaccessibleObjIds 不可访问的对象ID列表
     */
    private void checkCurrentUserDefaultDataScope(List<String> objIds, String dimensionType,
                                                 List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        // 获取当前用户的基本信息
        String currentUserCode = CurrentUserHolder.getCurrentUserCode();
        List<Long> userOrgIds = CurrentUserHolder.getBelongOrgIds();
        List<UsersOrganization> userOrganizations = CurrentUserHolder.getUsersOrganizations();
        List<Long> userPositionIds = userOrganizations.stream()
                .filter(org -> org.getPositionId() != null)
                .map(UsersOrganization::getPositionId)
                .distinct()
                .collect(Collectors.toList());
        UserStation userStation = CurrentUserHolder.getUserStation();
        Long userStationId = userStation != null ? userStation.getStationId() : null;

        // 根据维度类型检查本人默认数据范围权限
        switch (dimensionType) {
            case "user":
                // 用户维度：检查用户是否在当前用户的默认数据范围内
                checkUserDimensionDefaultScope(objIds, currentUserCode, accessibleObjIds, inaccessibleObjIds);
                break;
//            case "org":
//                // 组织维度：检查组织是否在当前用户的所属组织范围内
//                checkOrgDimensionDefaultScope(objIds, userOrgIds, accessibleObjIds, inaccessibleObjIds);
//                break;
//            case "position":
//                // 岗位维度：检查岗位是否在当前用户的所属岗位范围内
//                checkPositionDimensionDefaultScope(objIds, userPositionIds, accessibleObjIds, inaccessibleObjIds);
//                break;
//            case "station":
//                // 驻地维度：检查驻地是否在当前用户的所属驻地范围内
//                checkStationDimensionDefaultScope(objIds, userStationId, accessibleObjIds, inaccessibleObjIds);
//                break;
            default:
                // 其他维度暂不支持本人默认数据范围
                break;
        }
    }

    /**
     * 检查用户维度本人默认数据范围权限
     */
    private void checkUserDimensionDefaultScope(List<String> objIds, String currentUserCode,
                                              List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        // 这里需要根据业务规则确定当前用户默认可以访问哪些用户
        // 目前实现为：用户默认可以访问自己的数据
        for (String objId : objIds) {
            if (currentUserCode.equals(objId)) {
                // 如果是当前用户自己，直接添加到可访问列表
                if (!accessibleObjIds.contains(objId)) {
                    accessibleObjIds.add(objId);
                }
                if (inaccessibleObjIds.contains(objId)) {
                    inaccessibleObjIds.remove(objId);
                }
            }
            // 注意：这里不处理其他用户的默认权限，避免过度授权
            // 其他用户的访问权限应该通过权限组配置或扩展权限来控制
        }
    }

    /**
     * 检查组织维度本人默认数据范围权限
     */
    private void checkOrgDimensionDefaultScope(List<String> objIds, List<Long> userOrgIds,
                                             List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        // 当前用户默认可以访问自己所属的组织
        for (String objId : objIds) {
            try {
                Long orgId = Long.valueOf(objId);
                if (userOrgIds.contains(orgId)) {
                    if (!accessibleObjIds.contains(objId)) {
                        accessibleObjIds.add(objId);
                    }
                    if (inaccessibleObjIds.contains(objId)) {
                        inaccessibleObjIds.remove(objId);
                    }
                }
            } catch (NumberFormatException e) {
                // 忽略无效的组织ID
            }
        }
    }

    /**
     * 检查岗位维度本人默认数据范围权限
     */
    private void checkPositionDimensionDefaultScope(List<String> objIds, List<Long> userPositionIds,
                                                  List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        // 当前用户默认可以访问自己所属的岗位
        for (String objId : objIds) {
            try {
                Long positionId = Long.valueOf(objId);
                if (userPositionIds.contains(positionId)) {
                    if (!accessibleObjIds.contains(objId)) {
                        accessibleObjIds.add(objId);
                    }
                    if (inaccessibleObjIds.contains(objId)) {
                        inaccessibleObjIds.remove(objId);
                    }
                }
            } catch (NumberFormatException e) {
                // 忽略无效的岗位ID
            }
        }
    }

    /**
     * 检查驻地维度本人默认数据范围权限
     */
    private void checkStationDimensionDefaultScope(List<String> objIds, Long userStationId,
                                                 List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        // 当前用户默认可以访问自己所属的驻地
        if (userStationId != null) {
            String userStationIdStr = String.valueOf(userStationId);
            for (String objId : objIds) {
                if (userStationIdStr.equals(objId)) {
                    if (!accessibleObjIds.contains(objId)) {
                        accessibleObjIds.add(objId);
                    }
                    if (inaccessibleObjIds.contains(objId)) {
                        inaccessibleObjIds.remove(objId);
                    }
                }
            }
        }
    }

    /**
     * 检查用户维度权限
     * 需要关联default_data_permissions表查询权限组的默认数据权限范围
     * 数据范围类型：self(本人)、org(组织)、position(岗位)、station(驻地)
     *
     * @param permissionGroupIds 权限组ID列表
     * @param objIds 需要检查权限的对象ID列表
     * @param queryQO 查询条件对象
     * @param page 分页对象
     * @param accessibleObjIds 可访问的对象ID列表
     * @param inaccessibleObjIds 不可访问的对象ID列表
     * @param currentUserId 当前用户ID
     */
    private void checkUserDimensionPermission(List<Long> permissionGroupIds, List<String> objIds,
                                            AuthorizedUserQueryQO queryQO, Page<AuthorizedUserVO> page,
                                            List<String> accessibleObjIds, List<String> inaccessibleObjIds,
                                            Long currentUserId) {
        // 步骤1：批量查询权限组的默认数据权限范围，提高查询效率
        List<Long> permissionGroupIdsCopy = new ArrayList<>(permissionGroupIds);
        Set<String> allowedDataScopes = getAllowedDataScopes(permissionGroupIdsCopy);

        // 步骤2：根据数据权限范围选择最优的查询策略
        if (isSelfOnlyScope(allowedDataScopes)) {
            // 策略1：只有self权限，采用直接判断策略
            handleSelfOnlyPermission(objIds, currentUserId, accessibleObjIds, inaccessibleObjIds);
            return;
        }

        // 策略2：设置数据范围过滤条件，优化数据库查询
        setDataScopeQueryConditions(queryQO, allowedDataScopes, currentUserId);

        // 设置需要检查的用户列表到查询条件中
        queryQO.setUserCodeList(new ArrayList<>(objIds));

        // 步骤3：执行优化后的数据库查询
        List<AuthorizedUserVO> authorizedUsers = executeOptimizedUserQuery(queryQO, page);

        // 步骤4：处理查询结果，精确匹配权限
        processAuthorizedUsers(objIds, authorizedUsers, accessibleObjIds, inaccessibleObjIds, allowedDataScopes, currentUserId);
    }

    /**
     * 批量查询权限组的数据权限范围，提高查询效率
     *
     * @param permissionGroupIds 权限组ID列表
     * @return 允许的数据范围类型集合
     */
    private Set<String> getAllowedDataScopes(List<Long> permissionGroupIds) {
        Set<String> allowedDataScopes = new HashSet<>();

        for (Long permissionGroupId : permissionGroupIds) {
            DataPermissionVO dataPermission = defaultDataPermissionMapper.selectByPermissionGroupId(permissionGroupId);
            if (dataPermission != null && "active".equals(dataPermission.getStatus())) {
                allowedDataScopes.add(dataPermission.getDataScopeType());
            }
        }

        // 如果没有配置数据权限，只能看自己
        if (allowedDataScopes.isEmpty()) {
            allowedDataScopes.add("self");
        }

        return allowedDataScopes;
    }

    /**
     * 判断数据权限范围是否只有self
     *
     * @param allowedDataScopes 允许的数据范围类型集合
     * @return 是否只有self权限
     */
    private boolean isSelfOnlyScope(Set<String> allowedDataScopes) {
        return allowedDataScopes.contains("self") && allowedDataScopes.size() == 1;
    }

    /**
     * 处理只有self权限的情况
     * 当前用户只能查看自己的数据
     *
     * @param objIds 需要检查权限的对象ID列表
     * @param currentUserId 当前用户ID
     * @param accessibleObjIds 可访问的对象ID列表
     * @param inaccessibleObjIds 不可访问的对象ID列表
     */
    private void handleSelfOnlyPermission(List<String> objIds, Long currentUserId,
                                        List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        String currentUserCode = String.valueOf(currentUserId);
        if (objIds.contains(currentUserCode)) {
            accessibleObjIds.add(currentUserCode);
        }

        // 其他所有用户都不可访问
        for (String objId : objIds) {
            if (!currentUserCode.equals(objId)) {
                inaccessibleObjIds.add(objId);
            }
        }
    }

    /**
     * 根据数据权限范围设置查询条件，优化数据库查询性能
     *
     * @param queryQO 查询条件对象
     * @param allowedDataScopes 允许的数据范围类型集合
     * @param currentUserId 当前用户ID
     */
    private void setDataScopeQueryConditions(AuthorizedUserQueryQO queryQO, Set<String> allowedDataScopes, Long currentUserId) {
        // 设置组织范围条件
        if (allowedDataScopes.contains("org")) {
            queryQO.setUserScopeOrgList(getUserScopeOrgIds(allowedDataScopes));
        }

        // 设置岗位范围条件
        if (allowedDataScopes.contains("position")) {
            queryQO.setUserScopePositionList(getUserScopePositionIds(allowedDataScopes));
        }

        // 设置用户范围条件（主要用于self权限）
        queryQO.setUserScopeUserList(getUserScopeUserIds(allowedDataScopes, currentUserId));
    }

    /**
     * 执行优化的用户授权查询
     *
     * @param queryQO 查询条件对象
     * @param page 分页对象
     * @return 授权用户列表
     */
    private List<AuthorizedUserVO> executeOptimizedUserQuery(AuthorizedUserQueryQO queryQO, Page<AuthorizedUserVO> page) {
        return permissionGroupAuthorizedObjectMapper.selectAuthorizedUserPageByPermissionGroupIds(page, queryQO).getRecords();
    }

    /**
     * 处理授权用户查询结果，根据数据权限范围进行精确过滤
     *
     * @param objIds 需要检查权限的对象ID列表
     * @param authorizedUsers 授权用户列表
     * @param accessibleObjIds 可访问的对象ID列表
     * @param inaccessibleObjIds 不可访问的对象ID列表
     * @param allowedDataScopes 允许的数据范围类型集合
     * @param currentUserId 当前用户ID
     */
    private void processAuthorizedUsers(List<String> objIds, List<AuthorizedUserVO> authorizedUsers,
                                      List<String> accessibleObjIds, List<String> inaccessibleObjIds,
                                      Set<String> allowedDataScopes, Long currentUserId) {
        // 将授权用户转换为集合，便于快速查找
        Set<String> authorizedUserCodes = new HashSet<>();
        if (CollectionUtils.isNotEmpty(authorizedUsers)) {
            for (AuthorizedUserVO user : authorizedUsers) {
                authorizedUserCodes.add(user.getUserCode());
            }
        }

        // 确保每个对象只在一个列表中出现，避免重复
        Set<String> processedObjIds = new HashSet<>();

        // 首先处理在授权列表中的用户
        for (String objId : objIds) {
            if (processedObjIds.contains(objId)) {
                continue; // 已处理过，跳过
            }

            if (authorizedUserCodes.contains(objId)) {
                // 在授权列表中，检查是否符合数据权限范围
                if (isUserWithinDataScope(objId, currentUserId, allowedDataScopes)) {
                    accessibleObjIds.add(objId);
                } else {
                    inaccessibleObjIds.add(objId);
                }
            } else {
                // 不在授权列表中，标记为不可访问
                inaccessibleObjIds.add(objId);
            }
            processedObjIds.add(objId);
        }
    }

    /**
     * 检查用户是否在当前用户的数据权限范围内
     *
     * @param targetUserId 目标用户ID
     * @param currentUserId 当前用户ID
     * @param allowedDataScopes 允许的数据范围类型集合
     * @return 是否在权限范围内
     */
    private boolean isUserWithinDataScope(String targetUserId, Long currentUserId, Set<String> allowedDataScopes) {
        // 如果是当前用户自己，只要有任何权限都可以访问
        if (String.valueOf(currentUserId).equals(targetUserId)) {
            return true;
        }

        // 检查组织权限范围
        if (allowedDataScopes.contains("org")) {
            // 这里可以进一步检查目标用户是否在当前用户的组织范围内
            // 由于缺乏用户组织关系的精确查询，这里暂时信任数据库查询结果
            return true;
        }

        // 检查岗位权限范围
        if (allowedDataScopes.contains("position")) {
            // 这里可以进一步检查目标用户是否在当前用户的岗位范围内
            // 由于缺乏用户岗位关系的精确查询，这里暂时信任数据库查询结果
            return true;
        }

        // 检查驻地权限范围
        if (allowedDataScopes.contains("station")) {
            // 这里可以进一步检查目标用户是否在当前用户的驻地范围内
            // 由于缺乏用户驻地关系的精确查询，这里暂时信任数据库查询结果
            return true;
        }

        // 如果只有self权限且不是当前用户，则不可访问
        return false;
    }

    /**
     * 根据数据权限范围获取用户可访问的组织ID列表
     *
     * @param allowedDataScopes 允许的数据范围类型集合
     * @return 可访问的组织ID列表
     */
    private List<Long> getUserScopeOrgIds(Set<String> allowedDataScopes) {
        if (!allowedDataScopes.contains("org")) {
            return Collections.emptyList();
        }

        // 获取当前用户所属的组织ID列表
        return CurrentUserHolder.getBelongOrgIds();
    }

    /**
     * 根据数据权限范围获取用户可访问的岗位ID列表
     *
     * @param allowedDataScopes 允许的数据范围类型集合
     * @return 可访问的岗位ID列表
     */
    private List<Long> getUserScopePositionIds(Set<String> allowedDataScopes) {
        if (!allowedDataScopes.contains("position")) {
            return Collections.emptyList();
        }

        // 获取当前用户所属的岗位ID列表
        List<UsersOrganization> userOrganizations = CurrentUserHolder.getUsersOrganizations();
        return userOrganizations.stream()
                .filter(org -> org.getPositionId() != null)
                .map(UsersOrganization::getPositionId)
                .distinct()
                .collect(Collectors.toList());
    }

    /**
     * 根据数据权限范围获取用户可访问的用户ID列表
     *
     * @param allowedDataScopes 允许的数据范围类型集合
     * @param currentUserId 当前用户ID
     * @return 可访问的用户ID列表
     */
    private List<Long> getUserScopeUserIds(Set<String> allowedDataScopes, Long currentUserId) {
        List<Long> userIds = new ArrayList<>();

        // 如果允许查看本人，加入当前用户ID
        if (allowedDataScopes.contains("self")) {
            userIds.add(currentUserId);
        }

        // 注意：这里的逻辑依赖于数据库查询中的关联查询
        // org和position范围的处理在数据库层面通过关联查询实现
        // 这里只需要返回当前用户ID（如果有self权限）或其他特殊用户ID

        return userIds;
    }


    /**
     * 检查非用户维度权限
     * 只能看除了self之外的数据范围类型
     *
     * @param permissionGroupIds 权限组ID列表
     * @param dimensionType 维度类型
     * @param objIds 需要检查权限的对象ID列表
     * @param accessibleObjIds 可访问的对象ID列表
     * @param inaccessibleObjIds 不可访问的对象ID列表
     */
    private void checkNonUserDimensionPermission(List<Long> permissionGroupIds, String dimensionType,
                                               List<String> objIds, List<String> accessibleObjIds,
                                               List<String> inaccessibleObjIds) {
        // 过滤掉数据权限范围是"self"的权限组，因为非用户维度不能查看self范围的数据
        List<Long> filteredPermissionGroupIds = new ArrayList<>();
        for (Long permissionGroupId : permissionGroupIds) {
            DataPermissionVO dataPermission = defaultDataPermissionMapper.selectByPermissionGroupId(permissionGroupId);
            if (dataPermission == null || !"self".equals(dataPermission.getDataScopeType()) ||
                !"active".equals(dataPermission.getStatus())) {
                filteredPermissionGroupIds.add(permissionGroupId);
            }
        }

        // 如果过滤后没有有效的权限组，则所有对象都不可访问
        if (!filteredPermissionGroupIds.isEmpty()) {
            inaccessibleObjIds.addAll(objIds);
            return;
        }

        // 查询用户在这些过滤后的权限组下面的授权对象是否包含需要访问的对象列表objIds
        LambdaQueryWrapper<PermissionGroupAuthorizedObject> queryWrapper = new LambdaQueryWrapper<>();
        List<Long> authorizedObjectIds = objIds.stream().map(Long::valueOf).collect(Collectors.toList());
        queryWrapper.in(PermissionGroupAuthorizedObject::getAuthorizedObjectId, authorizedObjectIds);
        queryWrapper.eq(PermissionGroupAuthorizedObject::getObjectType, dimensionType);
        queryWrapper.in(PermissionGroupAuthorizedObject::getPermissionGroupId, filteredPermissionGroupIds);

        List<PermissionGroupAuthorizedObject> authorizedObjectList = permissionGroupAuthorizedObjectMapper.selectList(queryWrapper);

        if (CollectionUtils.isNotEmpty(authorizedObjectList)) {
            for (PermissionGroupAuthorizedObject record : authorizedObjectList) {
                String objIdStr = String.valueOf(record.getAuthorizedObjectId());
                if (objIds.contains(objIdStr)) {
                    accessibleObjIds.add(objIdStr);
                } else {
                    inaccessibleObjIds.add(objIdStr);
                }
            }
        }

        // 将未在授权列表中的对象加入不可访问列表
        for (String objId : objIds) {
            if (!accessibleObjIds.contains(objId) && !inaccessibleObjIds.contains(objId)) {
                inaccessibleObjIds.add(objId);
            }
        }
    }

    /**
     * 检查当前用户是否有访问单个数据实例的权限
     *
     * @param permissionGroupIds 权限组ID列表
     * @param dimensionType 维度类型
     * @param objId 数据实例ID
     * @param currentUserId 当前用户ID
     * @return 是否有权限
     */
    @SuppressWarnings("unused")
    private boolean checkSingleObjPermission(List<Long> permissionGroupIds, String dimensionType, Long objId, Long currentUserId) {
        // 检查每个权限组
        for (Long permissionGroupId : permissionGroupIds) {
            // 检查权限组是否存在且状态为active
            PermissionGroup permissionGroup = permissionGroupMapper.selectById(permissionGroupId);
            if (permissionGroup == null || !"active".equals(permissionGroup.getStatus())) {
                logger.debug("权限组不存在或未激活: permissionGroupId={}", permissionGroupId);
                continue;
            }

            // 检查当前用户是否属于该权限组的授权对象集合（已处理排除对象）
            if (isUserInEffectiveAuthorizedObjects(currentUserId, permissionGroupId, dimensionType)) {
                // 检查权限组是否有访问该维度列表的权限
//                if (checkDimensionDataPermission(permissionGroupId, dimensionType)) {
                    // 检查当前用户是否有扩展权限限制
                    if (checkUserExtendedPermission(currentUserId, permissionGroupId, dimensionType, objId)) {
                        return true;
                    }
//                }
            }
        }

        return false;
    }

    /**
     * 检查用户是否属于权限组的有效授权对象集合（已排除排除对象）
     *
     * @param userId 用户ID
     * @param permissionGroupId 权限组ID
     * @param dimensionType 维度类型
     * @return 是否属于有效授权对象
     */
    private boolean isUserInEffectiveAuthorizedObjects(Long userId, Long permissionGroupId, String dimensionType) {
        // 获取权限组的所有授权对象（排除已排除的对象）
        List<Long> effectiveObjectIds = getEffectiveAuthorizedObjectIds(permissionGroupId, dimensionType);

        // 检查用户是否直接在授权对象中
        if (effectiveObjectIds.contains(userId)) {
            return true;
        }

        // 检查用户所属的组织是否在授权对象中
        List<UsersOrganization> userOrganizations = CurrentUserHolder.getUsersOrganizations();
        if (ListUtil.isNotEmpty(userOrganizations)) {
            for (UsersOrganization org : userOrganizations) {
                if (effectiveObjectIds.contains(org.getOrgId())) {
                    return true;
                }

                // 检查用户所属的岗位是否在授权对象中
                if (org.getPositionId() != null && effectiveObjectIds.contains(org.getPositionId())) {
                    return true;
                }
            }
        }

        return false;
    }

    /**
     * 获取权限组的有效授权对象ID列表（已处理排除对象）
     *
     * @param permissionGroupId 权限组ID
     * @param dimensionType 维度类型
     * @return 有效授权对象ID列表
     */
    private List<Long> getEffectiveAuthorizedObjectIds(Long permissionGroupId, String dimensionType) {
        // 获取所有授权对象
        List<PermissionGroupAuthorizedObject> authorizedObjects =
            permissionGroupAuthorizedObjectMapper.selectByPermissionGroupIdAndObjectType(permissionGroupId, dimensionType);

        // 获取所有排除对象
        List<PermissionGroupExcludedObject> excludedObjects =
            permissionGroupExcludedObjectMapper.selectByPermissionGroupIdAndObjectType(permissionGroupId, dimensionType);

        List<Long> authorizedIds = authorizedObjects.stream()
            .map(PermissionGroupAuthorizedObject::getAuthorizedObjectId)
            .collect(java.util.stream.Collectors.toList());

        List<Long> excludedIds = excludedObjects.stream()
            .map(PermissionGroupExcludedObject::getExcludedObjectId)
            .collect(java.util.stream.Collectors.toList());

        // 从授权对象中移除排除对象
        authorizedIds.removeAll(excludedIds);

        return authorizedIds;
    }

    /**
     * 检查当前用户在权限组下是否有扩展权限访问指定的数据实例
     *
     * @param userId 用户ID
     * @param permissionGroupId 权限组ID
     * @param dimensionType 维度类型
     * @param objId 数据实例ID
     * @return 是否有扩展权限
     */
    private boolean checkUserExtendedPermission(Long userId, Long permissionGroupId, String dimensionType, Long objId) {
        // 获取用户的扩展权限配置
        AuthorizedObjectDataPermissionVO userExtendedPermission = authorizedObjectDataPermissionMapper.selectByPermissionGroupIdAndUserId(permissionGroupId, userId);
        if (userExtendedPermission == null || StringUtils.isBlank(userExtendedPermission.getPermissions())) {
            // 没有扩展权限配置，默认有权限
            return true;
        }

        // 解析permissions JSON字符串
        try {
            List<UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem> permissionItems =
                JSON.parseArray(userExtendedPermission.getPermissions(),
                    UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem.class);

            if (ListUtil.isEmpty(permissionItems)) {
                return true;
            }

            // 查找匹配维度类型的权限配置
            for (UpdateAuthorizedObjectDataPermissionDTO.DataPermissionItem item : permissionItems) {
                if (dimensionType.equals(getDimensionTypeFromDataScopeType(item.getDataScopeType()))) {
                    List<String> objList = item.getObjList();
                    if (ListUtil.isEmpty(objList)) {
                        // 如果没有指定对象列表，则认为有权限
                        return true;
                    }
                    // 检查数据实例ID是否在允许的列表中
                    return objList.contains(String.valueOf(objId));
                }
            }

            // 如果没有找到匹配的维度类型配置，默认无权限
            return false;
        } catch (Exception e) {
            logger.error("解析用户扩展权限配置失败: permissionGroupId={}, userId={}, permissions={}",
                permissionGroupId, userId, userExtendedPermission.getPermissions(), e);
            // 解析失败时，默认无权限（安全考虑）
            return false;
        }
    }

    /**
     * 根据数据范围类型转换为维度类型
     *
     * @param dataScopeType 数据范围类型
     * @return 维度类型
     */
    private String getDimensionTypeFromDataScopeType(String dataScopeType) {
        switch (dataScopeType) {
            case "self":
                return "user";
            case "org":
                return "org";
            case "position":
                return "position";
            case "station":
                return "station";
            default:
                return dataScopeType;
        }
    }

    /**
     * 检查用户是否属于指定的权限组
     *
     * @param userId 用户ID
     * @param permissionGroupId 权限组ID
     * @return 是否属于该权限组
     */
    @SuppressWarnings("unused")
    private boolean checkUserInPermissionGroup(Long userId, Long permissionGroupId) {
        // 检查用户是否直接被授权到该权限组
        Long userCount = permissionGroupAuthorizedObjectMapper.countByObject(
                permissionGroupId, "user", userId);
        if (userCount > 0) {
            return true;
        }

        // 检查用户所属的组织是否被授权到该权限组
        List<UsersOrganization> userOrganizations = CurrentUserHolder.getUsersOrganizations();
        if (ListUtil.isNotEmpty(userOrganizations)) {
            for (UsersOrganization org : userOrganizations) {
                Long orgCount = permissionGroupAuthorizedObjectMapper.countByObject(
                        permissionGroupId, "org", org.getOrgId());
                if (orgCount > 0) {
                    return true;
                }

                // 检查用户所属的岗位是否被授权到该权限组
                if (org.getPositionId() != null) {
                    Long positionCount = permissionGroupAuthorizedObjectMapper.countByObject(
                            permissionGroupId, "position", org.getPositionId());
                    if (positionCount > 0) {
                        return true;
                    }
                }
            }
        }

        return false;
    }

    /**
     * 检查权限组是否有访问指定维度列表的权限
     *
     * @param permissionGroupId 权限组ID
     * @param dimensionType 维度类型
     * @return 是否有权限
     */
    @SuppressWarnings("unused")
    private boolean checkDimensionDataPermission(Long permissionGroupId, String dimensionType) {
        // 获取权限组的功能权限列表
        List<PermissionResourceVO> resourcePermissions = permissionGroupResourceMapper.selectByPermissionGroupId(permissionGroupId);

        if (ListUtil.isEmpty(resourcePermissions)) {
            logger.debug("权限组没有配置功能权限: permissionGroupId={}", permissionGroupId);
            return false;
        }

        // 检查是否有查看权限（read权限）用于访问对应维度的列表
        // 这里简化逻辑：如果权限组有任何read权限，则认为有访问相应维度列表的权限
        // 在实际业务中，可能需要根据具体的资源ID来判断
        for (PermissionResourceVO resource : resourcePermissions) {
            if (resource.getPermissionTypes() != null &&
                resource.getPermissionTypes().contains("read")) {
                logger.debug("权限组有查看权限，允许访问{}维度列表: permissionGroupId={}",
                        dimensionType, permissionGroupId);
                return true;
            }
        }

        // 如果没有找到具体的功能权限，则检查数据权限范围
        // 获取权限组的默认数据权限
        DataPermissionVO dataPermission = defaultDataPermissionMapper.selectByPermissionGroupId(permissionGroupId);
        if (dataPermission == null) {
            logger.debug("权限组没有配置数据权限: permissionGroupId={}", permissionGroupId);
            return false;
        }

        // 检查数据权限范围是否允许访问该维度的数据
        String dataScopeType = dataPermission.getDataScopeType();
        if (dataScopeType == null) {
            return false;
        }

        // 根据维度类型和数据权限范围判断是否有权限
        switch (dimensionType) {
            case "user":
                // 用户维度：任何数据范围都允许查看用户列表（因为用户可以看到自己的信息）
                return true;
            case "org":
                // 组织维度：需要有组织级别或以上的数据权限
                return "org".equals(dataScopeType) || "position".equals(dataScopeType) ||
                       "station".equals(dataScopeType) || "all".equals(dataScopeType);
            case "position":
                // 岗位维度：需要有岗位级别或以上的数据权限
                return "position".equals(dataScopeType) || "org".equals(dataScopeType) ||
                       "station".equals(dataScopeType) || "all".equals(dataScopeType);
            case "station":
                // 驻地维度：需要有驻地级别或以上的数据权限
                return "station".equals(dataScopeType) || "all".equals(dataScopeType);
            default:
//                logger.warn("未知的维度类型: {}", dimensionType);
                return false;
        }
    }

    /**
     * 资源关联多个权限组
     * 为指定资源批量关联多个权限组（先删除原有关联，再添加新关联）
     *
     * @param associateDTO 资源关联权限组请求
     */
    @Transactional(rollbackFor = Exception.class)
    public void associateResourceToPermissionGroups(ResourceAssociatePermissionGroupsDTO associateDTO) {
        Long resourceId = associateDTO.getResourceId();
        List<Long> permissionGroupIds = associateDTO.getPermissionGroupIds();

        // 校验权限组是否存在
        if (ListUtil.isNotEmpty(permissionGroupIds)) {
            for (Long permissionGroupId : permissionGroupIds) {
                PermissionGroup existingGroup = permissionGroupMapper.selectById(permissionGroupId);
                if (existingGroup == null) {
                    throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                            "权限组不存在: permissionGroupId=" + permissionGroupId);
                }
            }
        }

        // 删除该资源的所有现有权限组关联
        permissionGroupResourceMapper.deleteByResourceId(resourceId);

        // 批量插入新的权限组关联
        if (ListUtil.isNotEmpty(permissionGroupIds)) {
            List<PermissionGroupResource> insertList = new ArrayList<>();
            Date now = new Date();
            Long currentUserId = CurrentUserHolder.getCurrentUserId();

            for (Long permissionGroupId : permissionGroupIds) {
                PermissionGroupResource resource = new PermissionGroupResource();
                resource.setId(SequenceService.nextSnowId());
                resource.setPermissionGroupId(permissionGroupId);
                resource.setResourceId(resourceId);
                resource.setCreateBy(currentUserId);
                resource.setCreateTime(now);
                insertList.add(resource);
            }

            if (ListUtil.isNotEmpty(insertList)) {
                permissionGroupResourceMapper.batchInsert(insertList);
            }
        }

        logger.info("资源关联权限组成功: resourceId={}, permissionGroupCount={}",
                resourceId, permissionGroupIds != null ? permissionGroupIds.size() : 0);
    }

    /**
     * 查询资源关联的权限组信息
     *
     * @param resourceId 资源ID
     * @return 权限组列表
     */
    public List<PermissionResourceVO> queryPermissionGroupsByResource(Long resourceId) {
        return permissionGroupResourceMapper.selectPermissionGroupsByResourceId(resourceId);
    }

    /**
     * 处理用户扩展权限覆盖逻辑
     *
     * @param dimensionType 维度类型
     * @param queryQO 查询条件对象
     * @param userScopeOrgList 用户组织范围列表
     * @param userScopePositionList 用户岗位范围列表
     * @param userScopeUserList 用户范围列表
     * @param objIds 待检查的对象ID列表
     * @param queryObjIdList 查询对象ID列表
     * @param accessibleObjIds 可访问对象ID列表
     * @param inaccessibleObjIds 不可访问对象ID列表
     */
    private void processUserExtendedPermissions(String dimensionType, AuthorizedUserQueryQO queryQO,
            List<Long> userScopeOrgList, List<Long> userScopePositionList, List<Long> userScopeUserList,
            List<String> objIds, List<Long> queryObjIdList, List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        queryQO.setUserScopeOrgList(userScopeOrgList);
        queryQO.setUserScopePositionList(userScopePositionList);

        switch (dimensionType) {
            case "user":
                processUserDimensionExtendedPermissions(queryQO, userScopeUserList, userScopeOrgList, userScopePositionList,
                    objIds, accessibleObjIds, inaccessibleObjIds);
                break;
            case "org":
                processOrgDimensionExtendedPermissions(userScopeOrgList, queryObjIdList, accessibleObjIds, inaccessibleObjIds);
                break;
            case "position":
                processPositionDimensionExtendedPermissions(userScopePositionList, queryObjIdList, accessibleObjIds, inaccessibleObjIds);
                break;
            default:
                break;
        }
    }

    /**
     * 处理用户维度扩展权限（含直接授权用户、授权组织下用户、授权岗位下用户）
     * 当前用户若被授权访问其他组织/岗位下的用户，则这些用户也纳入可访问范围
     */
    private void processUserDimensionExtendedPermissions(AuthorizedUserQueryQO queryQO, List<Long> userScopeUserList,
            List<Long> userScopeOrgList, List<Long> userScopePositionList,
            List<String> objIds, List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        // 1. 直接授权用户范围：仅按用户列表查询，避免与 org/position 条件 AND 导致结果过窄
        List<Long> savedOrgList = queryQO.getUserScopeOrgList();
        List<Long> savedPositionList = queryQO.getUserScopePositionList();
        queryQO.setUserScopeOrgList(null);
        queryQO.setUserScopePositionList(null);
        queryQO.setUserScopeUserList(userScopeUserList);
        applyUserScopeQueryResult(queryQO, objIds, accessibleObjIds, inaccessibleObjIds);
        queryQO.setUserScopeOrgList(savedOrgList);
        queryQO.setUserScopePositionList(savedPositionList);

        // 2. 授权拓展组织维度下的用户：当前用户被授权访问指定组织时，这些组织下的用户也可访问
        if (CollectionUtils.isNotEmpty(userScopeOrgList)) {
            queryQO.setUserScopeUserList(null);
            queryQO.setUserScopePositionList(null);
            queryQO.setUserScopeOrgList(userScopeOrgList);
            applyUserScopeQueryResult(queryQO, objIds, accessibleObjIds, inaccessibleObjIds);
            queryQO.setUserScopeUserList(userScopeUserList);
            queryQO.setUserScopePositionList(userScopePositionList);
        }

        // 3. 授权拓展岗位维度下的用户：当前用户被授权访问指定岗位时，这些岗位下的用户也可访问
        if (CollectionUtils.isNotEmpty(userScopePositionList)) {
            queryQO.setUserScopeUserList(null);
            queryQO.setUserScopeOrgList(null);
            queryQO.setUserScopePositionList(userScopePositionList);
            applyUserScopeQueryResult(queryQO, objIds, accessibleObjIds, inaccessibleObjIds);
            queryQO.setUserScopeUserList(userScopeUserList);
            queryQO.setUserScopeOrgList(userScopeOrgList);
        }
    }

    /**
     * 根据当前 queryQO 中的用户/组织/岗位范围查询用户，并将结果中在 objIds 内的用户标记为可访问
     */
    private void applyUserScopeQueryResult(AuthorizedUserQueryQO queryQO, List<String> objIds,
            List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        List<AuthorizedUserVO> scopeUserList = permissionGroupAuthorizedObjectMapper.selectAuthorizedUserUserScope(queryQO);
        if (CollectionUtils.isNotEmpty(scopeUserList)) {
            for (AuthorizedUserVO record : scopeUserList) {
                String userCode = record.getUserCode();
                // 扩展权限可以覆盖默认权限：若扩展权限允许访问，则从不可访问列表移除并加入可访问列表
                updateObjectAccessStatus(objIds, userCode, accessibleObjIds, inaccessibleObjIds);
            }
        }
    }

    /**
     * 处理组织维度扩展权限
     */
    private void processOrgDimensionExtendedPermissions(List<Long> userScopeOrgList, List<Long> queryObjIdList,
            List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        if (CollectionUtils.isNotEmpty(userScopeOrgList)) {
            List<Long> accessibleOrgList = userScopeOrgList.stream()
                    .distinct()
                    .filter(queryObjIdList::contains)
                    .toList();
            updateAccessibleObjects(accessibleOrgList, accessibleObjIds, inaccessibleObjIds);
        }
    }

    /**
     * 处理岗位维度扩展权限
     */
    private void processPositionDimensionExtendedPermissions(List<Long> userScopePositionList, List<Long> queryObjIdList,
            List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        if (CollectionUtils.isNotEmpty(userScopePositionList)) {
            List<Long> accessiblePositionList = userScopePositionList.stream()
                    .distinct()
                    .filter(queryObjIdList::contains)
                    .toList();
            updateAccessibleObjects(accessiblePositionList, accessibleObjIds, inaccessibleObjIds);
        }
    }

    /**
     * 更新对象访问状态：扩展权限覆盖默认权限
     */
    private void updateObjectAccessStatus(List<String> objIds, String objId, List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        if (objIds.contains(objId)) {
            if (inaccessibleObjIds.contains(objId)) {
                inaccessibleObjIds.remove(objId);
            }
            if (!accessibleObjIds.contains(objId)) {
                accessibleObjIds.add(objId);
            }
        }
    }

    /**
     * 更新可访问对象列表
     */
    private void updateAccessibleObjects(List<Long> accessibleIdList, List<String> accessibleObjIds, List<String> inaccessibleObjIds) {
        if (CollectionUtils.isNotEmpty(accessibleIdList)) {
            for (Long id : accessibleIdList) {
                String idStr = String.valueOf(id);
                // 扩展权限可以覆盖默认权限
                if (inaccessibleObjIds.contains(idStr)) {
                    inaccessibleObjIds.remove(idStr);
                }
                if (!accessibleObjIds.contains(idStr)) {
                    accessibleObjIds.add(idStr);
                }
            }
        }
    }

}

