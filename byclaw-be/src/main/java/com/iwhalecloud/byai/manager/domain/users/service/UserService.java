package com.iwhalecloud.byai.manager.domain.users.service;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import com.iwhalecloud.byai.manager.entity.temp.TempQo;
import java.util.Collection;
import java.util.Date;
import java.util.HashMap;
import java.util.List;

import java.util.Map;

import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.util.CollectionUtils;
import com.baomidou.mybatisplus.core.conditions.Wrapper;
import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.baomidou.mybatisplus.core.metadata.IPage;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.constants.errorcode.CommonErrorCode;
import com.iwhalecloud.byai.common.constants.users.IsLocked;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.util.StringUtil;

/**
 * 用户管理服务接口
 */

@Service
public class UserService {

    private static final Logger logger = LoggerFactory.getLogger(UserService.class);


    @Autowired
    private UsersMapper usersMapper;

    @Autowired
    private SequenceService SequenceService;

    /***
     * 保存用户信息
     *
     * @param users
     * @return ResponseUtil
     */
    public Users addUser(Users users) {

        // 业务验证验证用户编码唯一性
        Long count = usersMapper.countUsers(users.getUserCode(), null, null);
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.code.duplicate"));
        }

        // 业务验证验证用户工号唯一性如果不填写不校验
        if (StringUtil.isNotEmpty(users.getUserNumber())) {
            count = usersMapper.countUsers(null, users.getUserNumber(), null);
            if (count > 0) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.number.duplicate"));
            }
        }

        users.setUserId(SequenceService.nextVal());
        // 超级助手标识和用户标识保持一致
        users.setAssistantId(users.getUserId());
        users.setCreateDate(new Date());
        users.setStateTime(new Date());
        users.setUserEffDate(new Date());
        users.setState(UserState.ACTIVE);
        users.setIsLocked(IsLocked.NO);
        usersMapper.insert(users);

        return users;
    }

    /**
     * 更新用户
     *
     * @param users 用户信息
     */
    public void updateUser(Users users) {

        Long count = usersMapper.countUsers(users.getUserCode(), null, users.getUserId());
        if (count > 0) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.code.duplicate.simple"));
        }

        // 业务验证验证用户工号唯一性如果不填写不校验
        if (StringUtil.isNotEmpty(users.getUserNumber())) {
            count = usersMapper.countUsers(null, users.getUserNumber(), users.getUserId());
            if (count > 0) {
                throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("user.number.duplicate.simple"));
            }
        }

        users.setUpdateDate(new Date());
        usersMapper.updateById(users);
    }

    /**
     * 查找用户
     *
     * @param userId
     * @return
     */
    public Users findById(Long userId) {
        return usersMapper.selectById(userId);
    }

    /**
     * 根据用户编码查找用户信息
     *
     * @param userCode 用户编码
     * @return 用户标识
     */
    public Users findByUserCode(String userCode) {
        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Users::getUserCode, userCode);
        queryWrapper.eq(Users::getState, UserState.ACTIVE);
        return usersMapper.selectOne(queryWrapper);
    }

    /**
     * 根据用户名称查询用户信息
     * @param userName
     * @return
     */
    public List<Users> findByUserName(String userName) {
        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Users::getUserName, userName);
        queryWrapper.eq(Users::getState, UserState.ACTIVE);
        List<Users> users = usersMapper.selectList(queryWrapper);
        return users;
    }

    /**
     * 重置用户密码
     *
     * @param users 用户
     */
    public void resetPassword(Users users) {
        users.setUpdateDate(new Date());
        usersMapper.updateById(users);
    }

    /**
     * 删除用户信息
     *
     * @param userId 用户标识
     */
    public void deleteUser(Long userId) {

        // 查询用户
        Users users = this.findById(userId);
        if (users == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.not.exist"));
        }

        users.setState(UserState.DISABLED);
        usersMapper.updateById(users);
    }

    /**
     * 查询组织下面的用户标识
     *
     * @param orgId 组织标识
     * @return List
     */
    public List<Long> findUserIdsByOrgId(Long orgId) {
        return usersMapper.findUserIdsByOrgId(orgId);
    }

    /**
     * 分页查询用户信息
     *
     * @param page 分页信息
     * @param queryWrapper 查询对象
     * @return List<Users>
     */
    public List<Users> selectList(IPage<Users> page, Wrapper<Users> queryWrapper) {
        return usersMapper.selectList(page, queryWrapper);
    }

    /**
     * 保存用户
     *
     * @param users 保存用户信息
     */
    public void save(Users users) {
        users.setCreateDate(new Date());
        usersMapper.insert(users);
    }

    /**
     * 更新用户信息
     *
     * @param users 用户信息
     */
    public void update(Users users) {
        users.setUpdateDate(new Date());
        usersMapper.updateById(users);
    }

    /**
     * 根据用户手机号码查找用户信息
     *
     * @param phone 用户编码
     * @return 用户标识 如果多个数据返回第一个
     */
    public Users findByUserPhone(String phone) {
        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Users::getPhone, Sm4Util.encrypt(phone));
        queryWrapper.eq(Users::getState, UserState.ACTIVE);
        List<Users> users = usersMapper.selectList(queryWrapper);
        if (CollectionUtils.isEmpty(users) || users.size() > 1) {
            logger.info("当前手机号码查询用户为空或者多个 ", phone);
            return null;
        }
        return users.get(0);
    }

    /**
     * 查询用户列表
     *
     * @param userIds 用户标识
     * @return List<Users>
     */
    public List<Users> findUsersByUserIds(Collection<Long> userIds) {
        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.in(Users::getUserId, userIds);
        queryWrapper.eq(Users::getState, UserState.ACTIVE);
        return usersMapper.selectList(queryWrapper);
    }

    public Map<String, List<String>> queryEmailByOrgAndName(TempQo tempQo) {
        List<String> strings = usersMapper.queryEmailByOrgAndName(tempQo);
        Map<String, List<String>> map = new HashMap<>();
        map.put("emailList", strings);
        return map;
    }


    public Map<String, List<String>> queryNameByOrgAndName(TempQo tempQo) {
        List<String> strings = usersMapper.queryNameByOrgAndName(tempQo);
        Map<String, List<String>> map = new HashMap<>();
        map.put("nameList", strings);
        return map;
    }

    /**
     * 根据苹果用户ID查找用户
     *
     * @param appleUserId 苹果用户ID
     * @return 用户信息，未找到返回null
     */
    public Users findByAppleUserId(String appleUserId) {
        if (StringUtil.isEmpty(appleUserId)) {
            return null;
        }
        LambdaQueryWrapper<Users> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(Users::getAppleUserId, appleUserId);
        queryWrapper.eq(Users::getState, UserState.ACTIVE);
        List<Users> users = usersMapper.selectList(queryWrapper);
        if (CollectionUtils.isEmpty(users)) {
            logger.info("当前苹果用户ID查询用户为空: {}", appleUserId);
            return null;
        }
        return users.get(0);
    }

    /**
     * 绑定苹果用户ID到指定用户
     *
     * @param userId 用户ID
     * @param appleUserId 苹果用户ID
     */
    public void bindAppleUserId(Long userId, String appleUserId) {
        if (userId == null || StringUtil.isEmpty(appleUserId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("apple.bindapple.param.invalid"));
        }

        // 检查该苹果用户ID是否已经绑定到其他用户
        Users existingUser = findByAppleUserId(appleUserId);
        if (existingUser != null && !existingUser.getUserId().equals(userId)) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500,
                    I18nUtil.get("apple.userid.bindother"));
        }

        Users users = findById(userId);
        if (users == null) {
            throw new BaseException(CommonErrorCode.ERROR_CODE_50500, I18nUtil.get("user.not.exist"));
        }

        users.setAppleUserId(appleUserId);
        users.setUpdateDate(new Date());
        usersMapper.updateById(users);

        logger.info("用户绑定苹果账号成功: userId={}, appleUserId={}", userId, appleUserId);
    }
}
