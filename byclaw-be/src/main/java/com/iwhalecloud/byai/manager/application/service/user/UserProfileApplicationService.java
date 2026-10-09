package com.iwhalecloud.byai.manager.application.service.user;

import java.io.IOException;
import java.util.Date;
import com.alibaba.fastjson.JSON;

import com.baomidou.mybatisplus.core.conditions.update.LambdaUpdateWrapper;
import com.iwhalecloud.byai.common.constants.users.UserState;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.dto.users.UserProfileResponse;
import com.iwhalecloud.byai.manager.dto.users.UserProfileUpdateRequest;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.manager.mapper.users.UsersMapper;
import com.iwhalecloud.byai.manager.entity.customer.ByaiCustomerLeads;
import com.iwhalecloud.byai.manager.mapper.customer.ByaiCustomerLeadsMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.springframework.beans.BeanUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/** 当前登录用户的个人资料修改。 */
@Service
public class UserProfileApplicationService {

    private final UsersMapper usersMapper;

    private final UserAvatarApplicationService avatarService;

    private final ByaiCustomerLeadsMapper leadsMapper;
    private final SequenceService sequenceService;

    public UserProfileApplicationService(UsersMapper usersMapper, UserAvatarApplicationService avatarService,
                                         ByaiCustomerLeadsMapper leadsMapper, SequenceService sequenceService) {
        this.usersMapper = usersMapper;
        this.avatarService = avatarService;
        this.leadsMapper = leadsMapper;
        this.sequenceService = sequenceService;
    }

    /** 读取数据库中的当前用户资料，不使用会话中的旧快照。 */
    public UserProfileResponse getProfile() {
        Users user = currentUser();
        return response(user, readLead(user));
    }

    private Users currentUser() {
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        if (loginInfo == null || loginInfo.getUserId() == null || loginInfo.getUserId() <= 0) {
            throw new BaseException("login.user.not.logged.in");
        }
        Users user = usersMapper.selectById(loginInfo.getUserId());
        if (user == null || !UserState.ACTIVE.equals(user.getState())) {
            throw new BaseException("用户不存在或已禁用");
        }
        return user;
    }

    private ByaiCustomerLeads readLead(Users user) {
        ByaiCustomerLeads lead = leadsMapper.selectProfileByUserId(user.getUserId());
        if (lead == null && StringUtils.isNotBlank(user.getPhone())) {
            lead = leadsMapper.selectLegacyProfileByPhone(user.getPhone());
        }
        return lead;
    }

    private UserProfileResponse response(Users user, ByaiCustomerLeads lead) {
        return new UserProfileResponse(user.getUserName(), user.getAvatar(),
            lead == null ? null : lead.getCompanyName(), lead == null ? null : lead.getProfileRole(),
            UserProfileOptions.interests(lead == null ? null : lead.getProfileInterests()));
    }

    /** 用户行更新已取得事务锁，再读写线索，串行化同一用户的重复保存。 */
    private ByaiCustomerLeads saveLead(Users user, UserProfileUpdateRequest request) {
        ByaiCustomerLeads existing = readLead(user);
        if (existing == null && request.getCompanyName() == null) {
            if (request.getProfileRole() != null || request.getProfileInterests() != null) {
                throw new BaseException("请先填写公司 / 组织名称");
            }
            return null; // 兼容只修改姓名或头像的旧调用，不新增空白留资记录。
        }
        ByaiCustomerLeads lead = new ByaiCustomerLeads();
        if (existing != null) BeanUtils.copyProperties(existing, lead);
        boolean insert = existing == null || existing.getUserId() == null;
        if (insert) {
            lead.setId(sequenceService.nextVal());
            lead.setCreateTime(new Date());
        }
        lead.setUserId(user.getUserId());
        lead.setContactName(request.getUserName());
        lead.setPhone(user.getPhone());
        if (request.getCompanyName() != null) lead.setCompanyName(request.getCompanyName().trim());
        if (request.getProfileRole() != null) lead.setProfileRole(UserProfileOptions.role(request.getProfileRole()));
        if (request.getProfileInterests() != null) {
            lead.setProfileInterests(JSON.toJSONString(UserProfileOptions.interests(request.getProfileInterests())));
        }
        int rows = insert ? leadsMapper.insertProfile(lead) : leadsMapper.updateProfileLead(lead);
        if (rows != 1) throw new BaseException("个人资料保存失败");
        return lead;
    }

    /** 头像文件优先于地址；省略的扩展字段保留原值，提供的字段在同一事务内保存。 */
    @Transactional(rollbackFor = Exception.class)
    public UserProfileResponse updateProfile(UserProfileUpdateRequest request) throws IOException {
        Users user = currentUser();
        LoginInfo loginInfo = CurrentUserHolder.getLoginInfo();
        UserProfileOptions.role(request.getProfileRole());
        if (request.getProfileInterests() != null) UserProfileOptions.interests(request.getProfileInterests());

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

        ByaiCustomerLeads lead = saveLead(user, request);
        loginInfo.setUserName(request.getUserName());
        loginInfo.setAvatar(avatar);
        user.setUserName(request.getUserName());
        user.setAvatar(avatar);
        if (lead != null) loginInfo.setIsRetented(true);
        return response(user, lead);
    }
}
