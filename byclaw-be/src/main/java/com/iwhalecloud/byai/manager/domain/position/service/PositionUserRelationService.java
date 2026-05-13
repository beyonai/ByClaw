package com.iwhalecloud.byai.manager.domain.position.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.position.PositionUserRelation;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.position.PositionUserRelationMapper;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;

import java.util.List;
import java.util.Set;
import java.util.stream.Collectors;

/**
 * 岗位与管理员用户关系服务
 */
@Service
public class PositionUserRelationService {

    @Autowired
    private PositionUserRelationMapper positionUserRelationMapper;

    @Autowired
    private UsersMapper usersMapper;

    /**
     * 保存关系
     *
     * @param relation 关系实体
     */
    public void save(PositionUserRelation relation) {
        positionUserRelationMapper.insert(relation);
    }

    /**
     * 判断是否为审核人是否为数字岗位管理员
     * @param positionId 岗位ID
     * @param auditorIds 审核人
     * @return true/false
     */
    public boolean isAuditor(Long positionId, List<Long> auditorIds) {
        if (positionId == null) {
            return false;
        }
        if (CollectionUtils.isEmpty(auditorIds)) {
            return false;
        }
        LambdaQueryWrapper<PositionUserRelation> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(PositionUserRelation::getPositionId, positionId);
        wrapper.select(PositionUserRelation::getUserId);
        List<PositionUserRelation> positionUserRelations = positionUserRelationMapper.selectList(wrapper);
        if (CollectionUtils.isEmpty(positionUserRelations)) {
            return false;
        }
        Set<Long> userIds = positionUserRelations.stream().map(PositionUserRelation::getUserId).collect(Collectors.toSet());
        if (!userIds.containsAll(auditorIds)) {
            return false;
        }
        // 判断是否审核人是否存在
        List<Users> users = usersMapper.selectBatchIds(auditorIds);
        if (CollectionUtils.isEmpty(users) || users.size() != auditorIds.size()) {
            return false;
        }
        return true;
    }

}

