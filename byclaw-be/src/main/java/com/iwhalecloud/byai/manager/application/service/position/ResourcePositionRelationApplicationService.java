package com.iwhalecloud.byai.manager.application.service.position;

import java.util.Date;
import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

import com.iwhalecloud.byai.manager.application.service.operations.EvaluationManager;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtEvaluateService;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.position.PositionExtCatalog;
import com.iwhalecloud.byai.manager.entity.position.PositionUserRelation;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtEvaluate;
import com.iwhalecloud.byai.manager.mapper.position.PositionExtCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.position.PositionUserRelationMapper;
import com.iwhalecloud.byai.manager.qo.resource.SsResExtEvaluateQO;
import com.iwhalecloud.byai.manager.vo.resource.SsResExtEvaluateCompareVO;
import org.apache.commons.collections.CollectionUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.domain.position.enums.DigEmployeePositionStatusEnum;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.position.ResourcePositionApprovalDTO;
import com.iwhalecloud.byai.manager.dto.position.ResourcePositionBindDTO;
import com.iwhalecloud.byai.manager.entity.position.ResourcePositionRelation;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.position.ResourcePositionRelationMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.manager.qo.position.PositionResourceSearchQO;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.manager.vo.position.PositionDigitalEmployeeVo;

/**
 * 资源岗位关系应用服务
 */
@Service
public class ResourcePositionRelationApplicationService {

    @Autowired
    private PositionService positionService;

    @Autowired
    private ResourcePositionRelationMapper resourcePositionRelationMapper;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private PositionExtCatalogMapper positionExtCatalogMapper;

    @Autowired
    private EvaluationManager evaluationManager;

    @Autowired
    private SsResExtEvaluateService ssResExtEvaluateService;

    @Autowired
    private PositionUserRelationMapper positionUserRelationMapper;

    /**
     * 添加数字员工绑定岗位
     *
     * @param request 绑定请求
     * @return ResourcePositionRelation
     */
    public ResourcePositionRelation bindPositionResource(ResourcePositionBindDTO request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.add.position.nopermission"));
        }

        // 1. 校验岗位存在且是数字岗位
        validateDigitalPosition(request.getPositionId());
        LambdaQueryWrapper<PositionExtCatalog> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PositionExtCatalog::getPositionId, request.getPositionId());
        wrapper.select(PositionExtCatalog::getCatalogId);
        List<PositionExtCatalog> positionExtCatalogs = positionExtCatalogMapper.selectList(wrapper);
        if (CollectionUtils.isEmpty(positionExtCatalogs)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.position.catalogId.not.exist"));
        }
        Set<Long> catalogIds = positionExtCatalogs.stream().map(PositionExtCatalog::getCatalogId)
            .collect(Collectors.toSet());

        // 2. 校验资源存在
        SsResource ssResource = validateResource(request.getResourceId());
        Long catalogId = ssResource.getCatalogId();
        if (catalogId != null && !catalogIds.contains(catalogId)) {
            // 数字员工不属于这个领域，不能绑定这个数字岗位
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.position.catalogId.not.match"));
        }

        // 3. 检查是否已有记录
        ResourcePositionRelation existingRelation = getRelationByPositionAndResource(request.getPositionId(),
            request.getResourceId());
        if (existingRelation != null) {
            return existingRelation; // 已有记录，不要重复添加
        }

        // 4. 创建新的关联关系
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        ResourcePositionRelation relation = new ResourcePositionRelation();
        relation.setResourcePositionRelId(SequenceService.nextVal());
        relation.setPositionId(request.getPositionId());
        relation.setResourceId(request.getResourceId());
        relation.setStatus(DigEmployeePositionStatusEnum.OFF_JOB.getCode()); // 默认下岗状态
        relation.setCreateBy(String.valueOf(currentUserId));
        relation.setCreateTime(new Date());
        relation.setUpdateBy(String.valueOf(currentUserId));
        relation.setUpdateTime(new Date());

        resourcePositionRelationMapper.insert(relation);
        return relation;
    }

    /**
     * 解绑数字员工与岗位的关联关系
     *
     * @param request 解绑请求
     * @return ResourcePositionRelation
     */
    public ResourcePositionRelation unbindPositionResource(ResourcePositionBindDTO request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.unbind.position.nopermission"));
        }

        // 1. 校验岗位存在且是数字岗位
        validateDigitalPosition(request.getPositionId());
        // 2. 校验资源存在
        validateResource(request.getResourceId());

        // 3. 检查是否已有记录
        ResourcePositionRelation existingRelation = getRelationByPositionAndResource(request.getPositionId(),
            request.getResourceId());
        if (existingRelation == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.not.bind.position"));
        }

        resourcePositionRelationMapper.deleteById(existingRelation);
        return existingRelation;
    }

    /**
     * 上岗操作
     *
     * @param request 上岗请求
     * @return ResourcePositionRelation
     */
    public ResourcePositionRelation onJob(ResourcePositionBindDTO request) {
        // 管理员才允许操作
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.on.position.nopermission"));
        }

        // 1. 校验岗位存在且是数字岗位
        validateDigitalPosition(request.getPositionId());

        // 2. 校验资源存在
        validateResource(request.getResourceId());

        // 3. 查询关联记录
        ResourcePositionRelation relation = getRelationByPositionAndResource(request.getPositionId(),
            request.getResourceId());
        if (relation == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.not.bind.position"));
        }

        // 4.进行评估
        SsResExtEvaluateCompareVO compareVO = evaluationManager.immediatelyEvaluate(request.getResourceId());

        Integer isQualifiedForPost = compareVO.getIsQualifiedForPost();
        if (isQualifiedForPost != 1) {
            throw new BaseException(compareVO.getEvaluateResult());
        }

        // 5. 更新状态为上岗
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        relation.setStatus(DigEmployeePositionStatusEnum.ON_JOB.getCode());
        relation.setApprover(String.valueOf(currentUserId));
        relation.setUpdateBy(String.valueOf(currentUserId));
        relation.setUpdateTime(new Date());

        resourcePositionRelationMapper.updateById(relation);
        return relation;
    }

    /**
     * 下岗操作
     *
     * @param request 下岗请求
     * @return ResourcePositionRelation
     */
    public ResourcePositionRelation offJob(ResourcePositionBindDTO request) {
        // 管理员才允许操作
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.off.position.nopermission"));
        }

        // 1. 校验岗位存在且是数字岗位
        validateDigitalPosition(request.getPositionId());

        // 2. 校验资源存在
        validateResource(request.getResourceId());

        // 3. 查询关联记录
        ResourcePositionRelation relation = getRelationByPositionAndResource(request.getPositionId(),
            request.getResourceId());
        if (relation == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.not.bind.position"));
        }

        // 4. 更新状态为下岗
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        relation.setStatus(DigEmployeePositionStatusEnum.OFF_JOB.getCode());
        relation.setUpdateBy(String.valueOf(currentUserId));
        relation.setUpdateTime(new Date());

        resourcePositionRelationMapper.updateById(relation);
        return relation;
    }

    /**
     * 更新数字岗位与数字员工的绑定关系
     */
    private void updatePositionResource(ResourcePositionApprovalDTO request, ResourcePositionRelation relation,
        Long currentUserId) {
        Date now = new Date();

        // 审批同意
        if ("PASS".equals(request.getApprovalStatus())) {
            relation.setStatus(DigEmployeePositionStatusEnum.ON_JOB.getCode());
            relation.setOnJobTime(now);
        }
        else {
            // 审批拒绝
            relation.setStatus(DigEmployeePositionStatusEnum.REFUSE_JOB.getCode());
            relation.setOnJobTime(null);
        }

        // 7. 更新审批人信息
        relation.setApprover(String.valueOf(currentUserId));
        relation.setUpdateBy(String.valueOf(currentUserId));
        relation.setUpdateTime(now);

        resourcePositionRelationMapper.updateById(relation);
    }

    /**
     * 检查当前用户是否是岗位管理员
     *
     * @param positionId 岗位ID
     * @param userId 用户ID
     * @return 是否是岗位管理员
     */
    private boolean isPositionAdmin(Long positionId, Long userId) {
        // 获取岗位的关联数字岗位管理员
        LambdaQueryWrapper<PositionUserRelation> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PositionUserRelation::getPositionId, positionId);
        wrapper.eq(PositionUserRelation::getUserId, userId);
        PositionUserRelation relation = positionUserRelationMapper.selectOne(wrapper);
        if (relation == null) {
            return false;
        }
        return true;
    }

    /**
     * 查询岗位下的数字员工信息（分页）
     *
     * @param searchQO 查询对象
     * @return PageInfo&lt;PositionDigitalEmployeeVo&gt;
     */
    public PageInfo<PositionDigitalEmployeeVo> searchPositionResources(PositionResourceSearchQO searchQO) {
        if (searchQO.getPositionId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.positionid.notnull"));
        }

        // 1. 校验岗位存在且是数字岗位
        validateDigitalPosition(searchQO.getPositionId());

        // 2. 分页查询数字员工信息
        Page<PositionDigitalEmployeeVo> page = new Page<>(searchQO.getPageNum(), searchQO.getPageSize());
        Page<PositionDigitalEmployeeVo> resultPage = resourcePositionRelationMapper
            .selectDigitalEmployeesByPositionIdPage(page, searchQO);

        return PageHelperUtil.toPageInfo(resultPage);
    }

    /**
     * 校验岗位存在且是数字岗位
     *
     * @param positionId 岗位ID
     */
    private void validateDigitalPosition(Long positionId) {
        Position position = positionService.isDigitalPosition(positionId);
        if (position == null || position.getIsDigitalPosition() != 1) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.not.exist"));
        }
    }

    /**
     * 校验资源存在
     *
     * @param resourceId 资源ID
     * @return SsResource
     */
    private SsResource validateResource(Long resourceId) {
        SsResource resource = ssResourceMapper.selectById(resourceId);
        if (resource == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.employee.resource.not.exist"));
        }
        return resource;
    }

    /**
     * 根据岗位ID和资源ID查询关联关系
     *
     * @param positionId 岗位ID
     * @param resourceId 资源ID
     * @return ResourcePositionRelation
     */
    private ResourcePositionRelation getRelationByPositionAndResource(Long positionId, Long resourceId) {
        LambdaQueryWrapper<ResourcePositionRelation> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ResourcePositionRelation::getPositionId, positionId);
        wrapper.eq(ResourcePositionRelation::getResourceId, resourceId);
        return resourcePositionRelationMapper.selectOne(wrapper);
    }

    /**
     * 查询数字员工的评估分页结果
     *
     * @param evaluateQO 查询条件
     * @return PageInfo&lt;SsResExtEvaluate&gt;
     */
    public PageInfo<SsResExtEvaluate> selectEvaluateByPage(SsResExtEvaluateQO evaluateQO) {
        return ssResExtEvaluateService.selectEvaluateByPage(evaluateQO);
    }

}
