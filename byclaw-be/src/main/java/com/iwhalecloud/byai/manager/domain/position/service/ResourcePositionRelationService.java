package com.iwhalecloud.byai.manager.domain.position.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.position.enums.DigEmployeePositionStatusEnum;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.position.ResourcePositionRelation;
import com.iwhalecloud.byai.manager.mapper.position.ResourcePositionRelationMapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.exception.BaseException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import java.util.Date;
import java.util.List;

/**
 * 岗位与数字员工关系服务
 */
@Service
public class ResourcePositionRelationService {

    @Autowired
    private ResourcePositionRelationMapper relationMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 保存关系
     *
     * @param relation 关系实体
     */
    public void save(ResourcePositionRelation relation) {
        if (relation == null) {
            return;
        }
        if (relation.getResourcePositionRelId() == null) {
            relation.setResourcePositionRelId(SequenceService.nextVal());
        }
        relationMapper.insert(relation);
    }

    /**
     * 按岗位查询关联列表
     *
     * @param positionId 岗位ID
     * @return 关联数据
     */
    public List<ResourcePositionRelation> listByPositionId(Long positionId) {
        LambdaQueryWrapper<ResourcePositionRelation> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ResourcePositionRelation::getPositionId, positionId);
        return relationMapper.selectList(wrapper);
    }

    /**
     * 按数字员工查询关联列表
     *
     * @param resourceId 数字员工ID
     * @return 关联数据
     */
    public List<ResourcePositionRelation> listByResourceId(Long resourceId) {
        LambdaQueryWrapper<ResourcePositionRelation> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ResourcePositionRelation::getResourceId, resourceId);
        return relationMapper.selectList(wrapper);
    }

    /**
     * 更新关系
     *
     * @param relation 关系实体
     */
    public void update(ResourcePositionRelation relation) {
        relationMapper.updateById(relation);
    }

    /**
     * 申请上岗
     */
    public void applyForPosition(Long resourceId, Long positionId) {
        LambdaQueryWrapper<ResourcePositionRelation> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(ResourcePositionRelation::getPositionId, positionId);
        wrapper.eq(ResourcePositionRelation::getResourceId, resourceId);
        // 获取资源关联的岗位
        ResourcePositionRelation relation = relationMapper.selectOne(wrapper);
        if (relation != null) {
            Integer status = relation.getStatus();
            if (DigEmployeePositionStatusEnum.ON_JOB.getCode().equals(status)) {
                throw new BaseException("operations.digemployee.position.already.onjob");
            }
            relation.setStatus(DigEmployeePositionStatusEnum.APPLY_JOB.getCode());
            relationMapper.updateById(relation);
            return;
        }
        relation = new ResourcePositionRelation();
        relation.setResourcePositionRelId(SequenceService.nextVal());
        relation.setResourcePositionRelId(0L);
        relation.setPositionId(positionId);
        relation.setResourceId(resourceId);
        relation.setStatus(DigEmployeePositionStatusEnum.APPLY_JOB.getCode());
        relation.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        relation.setCreateTime(new Date());
        relationMapper.insert(relation);
    }
}

