package com.iwhalecloud.byai.manager.domain.token.service;

import java.util.Date;
import java.util.List;

import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.entity.token.UserAccessToken;
import com.iwhalecloud.byai.manager.mapper.token.UserAccessTokenMapper;
import com.iwhalecloud.byai.common.constants.Constants;

/**
 * @author he.duming
 * @date 2025-06-05 17:26:35
 * @description TODO
 */
@Service
public class UserAccessTokenService {

    @Autowired
    private UserAccessTokenMapper userAccessTokenMapper;

    @Autowired
    private SequenceService SequenceService;

    /**
     * 简单列表查询
     *
     * @param page 分页参数
     * @param queryWrapper 查询对象
     * @return Position
     */
    public List<UserAccessToken> selectList(IPage<UserAccessToken> page, Wrapper<UserAccessToken> queryWrapper) {
        return userAccessTokenMapper.selectList(page, queryWrapper);
    }

    /***
     * 查询令牌
     * 
     * @param userAccessTokenId 令牌主键
     * @return UserAccessToken
     */
    public UserAccessToken findById(Long userAccessTokenId) {
        LambdaQueryWrapper<UserAccessToken> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UserAccessToken::getUserAccessTokenId, userAccessTokenId);
        queryWrapper.eq(UserAccessToken::getTokenStatus, Constants.STATUS_00A);
        return userAccessTokenMapper.selectOne(queryWrapper);
    }

    /***
     * 根据令牌查询用户信息
     *
     * @param accessToken 令牌
     * @return UserAccessToken
     */
    public UserAccessToken findByAccessToken(String accessToken) {
        LambdaQueryWrapper<UserAccessToken> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UserAccessToken::getAccessToken, accessToken);
        queryWrapper.eq(UserAccessToken::getTokenStatus, Constants.STATUS_00A);
        return userAccessTokenMapper.selectOne(queryWrapper);
    }

    /***
     * 保存令牌
     */
    public void save(UserAccessToken userAccessToken) {

        userAccessToken.setUserAccessTokenId(SequenceService.nextVal());
        userAccessToken.setCreateTime(new Date());

        userAccessTokenMapper.insert(userAccessToken);
    }

    /**
     * 更新停牌
     * 
     * @param userAccessToken 令牌信息
     */
    public void update(UserAccessToken userAccessToken) {
        userAccessTokenMapper.updateById(userAccessToken);
    }

    /**
     * 查询用户认证token信息
     * 
     * @param accessTokenName 信息名称
     * @param userId 用户标识
     * @return Long
     */
    public Long countAccessToken(String accessTokenName, Long userId) {
        LambdaQueryWrapper<UserAccessToken> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(UserAccessToken::getUserId, userId);
        queryWrapper.eq(UserAccessToken::getTokenStatus, Constants.STATUS_00A);
        queryWrapper.eq(UserAccessToken::getAccessTokenName, accessTokenName);
        return userAccessTokenMapper.selectCount(queryWrapper);
    }
}
