package com.iwhalecloud.byai.manager.domain.users.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.mapper.users.UserExternalSystemMapper;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

/**
 * @author he.duming
 * @date 2025-05-20 14:10:48
 * @description TODO
 */

@Service
public class UserExternalSystemService {

    @Autowired
    private UserExternalSystemMapper userExternalSystemMapper;

    /**
     * 保存用户关联外系统信息
     *
     * @param userExternalSystem 外系统绑定信息
     */
    public void save(UserExternalSystem userExternalSystem) {
        userExternalSystemMapper.insert(userExternalSystem);
    }

    /**
     * 更新外系统关联信息
     *
     * @param userExternalSystem 外系统绑定信息
     */
    public void update(UserExternalSystem userExternalSystem) {
        userExternalSystemMapper.updateById(userExternalSystem);
    }

    /**
     * 更新外系统关联信息
     *
     * @param id 系统主键
     */
    public void deleteById(Long id) {
        userExternalSystemMapper.deleteById(id);
    }

    /**
     * @param sourceType 用户类型
     * @param unionId 用户唯一标识
     * @return UserExternalSystem
     */
    public UserExternalSystem findByUnionId(Integer sourceType, String unionId) {
        LambdaQueryWrapper<UserExternalSystem> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UserExternalSystem::getSourceType, sourceType);
        queryWrapper.eq(UserExternalSystem::getUnionId, unionId);
        return userExternalSystemMapper.selectOne(queryWrapper);
    }

}
