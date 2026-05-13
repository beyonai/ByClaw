package com.iwhalecloud.byai.manager.application.service.position;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.application.service.user.UserApplicationService;
import com.iwhalecloud.byai.manager.domain.organization.service.OrganizationService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.dto.position.CatalogWithPositionsDTO;
import com.iwhalecloud.byai.manager.dto.position.DigitalPositionCreateDTO;
import com.iwhalecloud.byai.manager.dto.position.DigitalPositionUpdateDTO;
import com.iwhalecloud.byai.manager.dto.position.PositionUserBindDTO;
import com.iwhalecloud.byai.manager.entity.position.PositionUserRelation;
import com.iwhalecloud.byai.manager.entity.position.ResourcePositionRelation;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.qo.position.DigitalPositionSearchQO;
import com.iwhalecloud.byai.manager.qo.position.PositionAdminSearchQO;
import com.iwhalecloud.byai.manager.entity.position.Position;
import com.iwhalecloud.byai.manager.entity.position.PositionExtCatalog;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.domain.position.service.PositionService;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.position.PositionExtCatalogMapper;
import com.iwhalecloud.byai.manager.mapper.position.PositionMapper;
import com.iwhalecloud.byai.manager.mapper.position.PositionUserRelationMapper;
import com.iwhalecloud.byai.manager.mapper.position.ResourcePositionRelationMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.PageHelperUtil;
import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.vo.position.PositionUsersVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.ArrayList;
import java.util.Date;
import java.util.List;

/**
 * 数字岗位应用服务
 */
@Service
public class DigitalPositionApplicationService {

    @Autowired
    private SsResourceCatalogMapper ssResourceCatalogMapper;

    @Autowired
    private PositionExtCatalogMapper positionExtCatalogMapper;

    @Autowired
    private PositionMapper positionMapper;

    @Autowired
    private PositionUserRelationMapper positionUserRelationMapper;

    @Autowired
    private ResourcePositionRelationMapper resourcePositionRelationMapper;

    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private PositionService positionService;

    @Autowired
    private OrganizationService organizationService;

    /**
     * 校验岗位存在且是数字岗位
     *
     * @param positionId 岗位ID
     * @return Position
     */
    private Position validateDigitalPosition(Long positionId) {
        LambdaQueryWrapper<Position> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Position::getPositionId, positionId);
        wrapper.eq(Position::getIsDigitalPosition, 1);
        Position position = positionMapper.selectOne(wrapper);
        if (position == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.not.exist"));
        }
        return position;
    }

    /**
     * 校验用户存在
     *
     * @param userIds 用户ID
     * @return Users
     */
    private List<Users> validateUser(List<Long> userIds) {
        if (CollectionUtils.isEmpty(userIds)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.not.exist"));
        }
        LambdaQueryWrapper<Users> wrapper = new LambdaQueryWrapper<>();
        wrapper.in(Users::getUserId, userIds);
        wrapper.eq(Users::getState, UserState.ACTIVE);
        List<Users> users = usersMapper.selectList(wrapper);
        if (CollectionUtils.isEmpty(users) || users.size() != userIds.size()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.not.exist"));
        }
        return users;
    }

    /**
     * 校验岗位与用户的绑定关系是否存在
     *
     * @param positionId 岗位ID
     * @param userIds 用户ID
     * @return PositionUserRelation
     */
    private boolean validatePositionUserRelation(Long positionId, List<Long> userIds) {
        LambdaQueryWrapper<PositionUserRelation> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PositionUserRelation::getPositionId, positionId);
        queryWrapper.in(PositionUserRelation::getUserId, userIds);
        List<PositionUserRelation> relations = positionUserRelationMapper.selectList(queryWrapper);
        if (CollectionUtils.isEmpty(relations) || relations.size() != userIds.size()) {
            return false;
        }
        return true;
    }

    /**
     * 创建数字岗位（岗位绑定领域，支持多选）
     *
     * @param request 请求参数
     * @return ResponseUtil
     */
    public Position createDigitalPosition(DigitalPositionCreateDTO request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.add.nopermission"));
        }

        // 1.校验领域是否存在（批量校验）
        List<Long> catalogIds = request.getCatalogIds();
        List<SsResourceCatalog> catalogs = ssResourceCatalogMapper.selectBatchIds(catalogIds);
        if (CollectionUtils.isEmpty(catalogs) || catalogs.size() != catalogIds.size()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("digital.position.catalog.not.exist"));
        }

        // 2.校验“领域下数字岗位名称是否重复”
        Long duplicateCount = positionExtCatalogMapper.countPositionNameInCatalogs(catalogIds,
            request.getPositionName());
        if (duplicateCount != null && duplicateCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                I18nUtil.get("digital.position.name.duplicate.in.catalog"));
        }

        // 3.创建岗位（复用原岗位创建逻辑：包含全局岗位名重复校验+生成ID）
        Position position = new Position();
        position.setPositionName(request.getPositionName());
        position.setPositionDesc(request.getPositionDesc());
        position.setPositionId(SequenceService.nextVal());
        position.setIsDigitalPosition(1);
        positionMapper.insert(position);

        // 4.创建岗位-领域关系（批量插入）
        List<PositionExtCatalog> relationList = new ArrayList<>(catalogIds.size());
        Date now = new Date();
        String operator = String.valueOf(CurrentUserHolder.getCurrentUserId());
        for (Long catalogId : catalogIds) {
            PositionExtCatalog relation = new PositionExtCatalog();
            relation.setPositionId(position.getPositionId());
            relation.setCatalogId(catalogId);
            relation.setCreateBy(operator);
            relation.setCreateTime(now);
            relation.setUpdateBy(operator);
            relation.setUpdateTime(now);
            relationList.add(relation);
        }
        positionExtCatalogMapper.saveBatch(relationList);

        return position;
    }

    /**
     * 查询数字岗位列表（支持按领域过滤和岗位名称搜索，分页）
     *
     * @param searchQO 查询对象
     * @return PageInfo<CatalogWithPositionsDTO>
     */
    public List<CatalogWithPositionsDTO> searchDigitalPositions(DigitalPositionSearchQO searchQO) {
        // 使用连表查询获取领域及其关联岗位数据
        return positionExtCatalogMapper.selectCatalogsWithPositions(searchQO.getCatalogId(),
            searchQO.getPositionName());
    }

    /**
     * 更新数字岗位
     *
     * @param request 更新请求
     * @return ResponseUtil
     */
    public Position updateDigitalPosition(DigitalPositionUpdateDTO request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.update.nopermission"));
        }

        if (request == null || request.getPositionId() == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.positionid.notnull"));
        }

        // 1.校验岗位存在且是数字岗位
        LambdaQueryWrapper<Position> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Position::getPositionId, request.getPositionId());
        wrapper.eq(Position::getIsDigitalPosition, 1);
        Position position = positionMapper.selectOne(wrapper);
        if (position == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.not.exist"));
        }

        // 2.校验岗位名称是否重复（排除自身）
        if (!position.getPositionName().equals(request.getPositionName())) {
            LambdaQueryWrapper<Position> queryWrapper = new LambdaQueryWrapper<>();
            queryWrapper.ne(Position::getPositionId, request.getPositionId());
            queryWrapper.eq(Position::getPositionName, request.getPositionName());
            queryWrapper.eq(Position::getIsDigitalPosition, 1);
            Long count = positionMapper.selectCount(queryWrapper);
            if (count != null && count > 0) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("digital.position.name.duplicate.in.catalog"));
            }
        }

        // 3) 更新岗位信息
        position.setPositionName(request.getPositionName());
        position.setPositionDesc(request.getPositionDesc());
        positionService.updatePosition(position);

        return position;
    }

    /**
     * 删除数字岗位
     *
     * @param positionId 岗位ID
     * @return ResponseUtil
     */
    public Position deleteDigitalPosition(Long positionId) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.delete.nopermission"));
        }

        // 1.校验岗位存在且是数字岗位
        Position position = validateDigitalPosition(positionId);

        // 2.校验没有关联的用户关系
        LambdaQueryWrapper<PositionUserRelation> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(PositionUserRelation::getPositionId, positionId);
        Long userRelationCount = positionUserRelationMapper.selectCount(queryWrapper);
        if (userRelationCount != null && userRelationCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.has.user"));
        }

        // 3.校验没有关联的资源关系
        LambdaQueryWrapper<ResourcePositionRelation> lambdaQueryWrapper = new LambdaQueryWrapper<>();
        lambdaQueryWrapper.eq(ResourcePositionRelation::getPositionId, positionId);
        Long resourceRelationCount = resourcePositionRelationMapper.selectCount(lambdaQueryWrapper);
        if (resourceRelationCount != null && resourceRelationCount > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("digital.position.has.resource"));
        }

        // 4.删除岗位-领域关系
        LambdaQueryWrapper<PositionExtCatalog> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(PositionExtCatalog::getPositionId, positionId);
        positionExtCatalogMapper.delete(deleteWrapper);

        // 5.删除岗位
        positionMapper.deleteById(positionId);
        return position;
    }

    /**
     * 绑定岗位与用户关联
     *
     * @param request 绑定请求
     * @return ResponseUtil
     */
    public List<PositionUserRelation> bindPositionUser(PositionUserBindDTO request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("digital.position.add.nopermission"));
        }

        // 1.校验岗位存在且是数字岗位
        validateDigitalPosition(request.getPositionId());

        // 2.校验用户存在
        validateUser(request.getUserIds());

        // 3.校验是否已有绑定关系
        boolean isBind = validatePositionUserRelation(request.getPositionId(), request.getUserIds());
        if (isBind) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("position.user.relation.exists"));
        }

        // 4.创建绑定关系
        Long currentUserId = CurrentUserHolder.getCurrentUserId();
        List<PositionUserRelation> relations = new ArrayList<>();
        for (Long userId : request.getUserIds()) {
            PositionUserRelation relation = new PositionUserRelation();
            relation.setDigPositionRelId(SequenceService.nextVal());
            relation.setPositionId(request.getPositionId());
            relation.setUserId(userId);
            relation.setCreateBy(String.valueOf(currentUserId));
            relation.setCreateTime(new Date());
            relation.setUpdateBy(String.valueOf(currentUserId));
            relation.setUpdateTime(new Date());
            relations.add(relation);
        }
        if (!CollectionUtils.isEmpty(relations)) {
            positionUserRelationMapper.saveBatch(relations);
        }
        return relations;
    }

    /**
     * 移除岗位与用户绑定
     * @param request 解绑请求
     */
    public void unbindPositionUser(PositionUserBindDTO request) {
        if (!CurrentUserHolder.isPlatformManager()) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("position.delete.nopermission"));
        }

        // 1.校验岗位存在且是数字岗位
        validateDigitalPosition(request.getPositionId());

        // 2.校验用户存在
        validateUser(request.getUserIds());

        // 3.校验绑定关系存在并获取关系对象
        boolean isBind = validatePositionUserRelation(request.getPositionId(), request.getUserIds());
        if (!isBind) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("position.user.relation.not.exists"));
        }

        // 4.删除绑定关系
        LambdaQueryWrapper<PositionUserRelation> deleteWrapper = new LambdaQueryWrapper<>();
        deleteWrapper.eq(PositionUserRelation::getPositionId, request.getPositionId());
        deleteWrapper.in(PositionUserRelation::getUserId, request.getUserIds());
        positionUserRelationMapper.delete(deleteWrapper);
    }

    /**
     * 查询数字岗位下的管理员用户信息（分页）
     *
     * @param searchQO 查询对象
     * @return PageInfo<UsersDetailVo>
     */
    public PageInfo<PositionUsersVo> searchPositionAdmins(PositionAdminSearchQO searchQO) {
        // 1.校验岗位存在且是数字岗位
        validateDigitalPosition(searchQO.getPositionId());

        // 2.分页查询用户信息
        Page<PositionUsersVo> page = new Page<>(searchQO.getPageNum(), searchQO.getPageSize());
        positionUserRelationMapper.selectUsersByPositionIdPage(page, searchQO);

        // 3.处理查询结果
        List<PositionUsersVo> records = page.getRecords();
        for (int i = 0; records != null && i < records.size(); i++) {
            PositionUsersVo positionUsersVo = records.get(i);
            String orgIdStr = positionUsersVo.getOrgIds();
            positionUsersVo.setPhone(UserApplicationService.decryptAndMaskPhone(positionUsersVo.getPhone()));
            List<Long> orgIds = new ArrayList<>();
            for (String orgId : orgIdStr.split(",")) {
                orgIds.add(Long.parseLong(orgId));
            }
            String pathName = organizationService.buildPathNameByOrgIds(orgIds);
            positionUsersVo.setPathName(pathName);
        }

        return PageHelperUtil.toPageInfo(page);
    }

}
