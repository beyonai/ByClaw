package com.iwhalecloud.byai.manager.application.service.user;

import java.io.IOException;
import java.util.Date;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.users.UserProfileResponse;
import com.iwhalecloud.byai.manager.dto.users.UserProfileUpdateRequest;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 当前登录用户的个人资料修改。 */
@Service
public class UserProfileApplicationService {

    private final UsersMapper usersMapper;

    private final UserAvatarApplicationService avatarService;

    public UserProfileApplicationService(UsersMapper usersMapper, UserAvatarApplicationService avatarService) {
        this.usersMapper = usersMapper;
        this.avatarService = avatarService;
    }

    /** 头像文件优先于地址；只写入当前用户的用户名和最终头像。 */
    @Transactional(rollbackFor = Exception.class)
    public UserProfileResponse updateProfile(UserProfileUpdateRequest request) throws IOException {
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo == null || loginInfo.getUserId() == null || loginInfo.getUserId() <= 0) {
            throw new BaseException("login.user.not.logged.in");
        }
        Users user = usersMapper.selectById(loginInfo.getUserId());
        if (user == null || !UserState.ACTIVE.equals(user.getState())) {
            throw new BaseException("用户不存在或已禁用");
        }

        LambdaUpdateWrapper<Users> update = new LambdaUpdateWrapper<Users>()
            .eq(Users::getUserId, loginInfo.getUserId())
            .eq(Users::getState, UserState.ACTIVE)
            .set(Users::getUserName, request.getUserName())
            .set(Users::getUpdateDate, new Date());
        String avatar = user.getAvatar();
        if (request.getAvatarFile() != null && !request.getAvatarFile().isEmpty()) {
            avatar = avatarService.storeAvatar(request.getAvatarFile());
            update.set(Users::getAvatar, avatar);
        }
        else if (StringUtils.isNotBlank(request.getAvatar())) {
            avatar = request.getAvatar();
            update.set(Users::getAvatar, avatar);
        }
        if (usersMapper.update(null, update) != 1) {
            throw new BaseException("个人信息保存失败");
        }

        loginInfo.setUserName(request.getUserName());
        loginInfo.setAvatar(avatar);
        return new UserProfileResponse(request.getUserName(), avatar);
    }
}
