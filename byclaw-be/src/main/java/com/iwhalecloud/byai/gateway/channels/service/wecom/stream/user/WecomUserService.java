package com.iwhalecloud.byai.gateway.channels.service.wecom.stream.user;

import com.iwhalecloud.byai.common.constants.users.SourceType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.domain.enterprise.service.EnterpriseInfoService;
import com.iwhalecloud.byai.manager.domain.superassist.service.SuasSuperassistService;
import com.iwhalecloud.byai.manager.domain.users.service.UserExternalSystemService;
import com.iwhalecloud.byai.manager.domain.users.service.UserService;
import com.iwhalecloud.byai.manager.entity.superassist.SuasSuperassist;
import com.iwhalecloud.byai.manager.entity.users.UserExternalSystem;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Service;
import org.springframework.util.StringUtils;

import java.util.Date;
import java.util.List;

/**
 * Resolves a WeCom {@code from.userid} to a Byclaw user, mirroring
 * {@code DingtalkUserService}: existing bindings win; otherwise a configured
 * WeCom contact user-detail API is used to resolve and save a new binding.
 *
 * <p>{@code from.userid} is plaintext when the bot creator is a super-admin,
 * otherwise encrypted; either way it is used as the stable external union key
 * against {@link SourceType#WE_CHAT}. Full userid values are never logged.
 *
 * <p>IMPORTANT: {@link #resolveLoginInfo} sets {@link CurrentUserHolder} on
 * success (session creation depends on it, exactly like DingTalk); the CALLER
 * must {@link CurrentUserHolder#clearLoginInfo()} in a finally block on the
 * async handling thread to avoid leaking login state into the pooled thread.
 */
@Service
public class WecomUserService {

    private static final Logger logger = LoggerFactory.getLogger(WecomUserService.class);

    private final UserService userService;
    private final UserExternalSystemService userExternalSystemService;
    private final EnterpriseInfoService enterpriseInfoService;
    private final SuasSuperassistService suasSuperassistService;
    private final SequenceService sequenceService;
    private final WecomContactUserService contactUserService;

    public WecomUserService(UserService userService,
                            UserExternalSystemService userExternalSystemService,
                            EnterpriseInfoService enterpriseInfoService,
                            SuasSuperassistService suasSuperassistService,
                            SequenceService sequenceService,
                            WecomContactUserService contactUserService) {
        this.userService = userService;
        this.userExternalSystemService = userExternalSystemService;
        this.enterpriseInfoService = enterpriseInfoService;
        this.suasSuperassistService = suasSuperassistService;
        this.sequenceService = sequenceService;
        this.contactUserService = contactUserService;
    }

    /**
     * Resolve and set the current login. Returns null when no Byclaw user is
     * bound to this WeCom userid (caller should reply a no-account message).
     */
    public LoginInfo resolveLoginInfo(String fromUserId, String botId) {
        if (fromUserId == null || fromUserId.isBlank()) {
            logger.warn("WeCom message with empty from.userid, cannot resolve user.");
            return null;
        }

        UserExternalSystem binding = userExternalSystemService.findByUnionId(SourceType.WE_CHAT, fromUserId);
        if (binding != null && binding.getUserId() != null) {
            Users user = userService.findById(binding.getUserId());
            if (user == null) {
                logger.warn("WeCom external binding present but local user missing. userId={}", binding.getUserId());
                return null;
            }
            return buildLoginInfo(user);
        }

        Users matchedUser = resolveAndBindFromContactUserDetail(fromUserId, botId);
        if (matchedUser == null) {
            logger.info("No WeCom external binding for the given userid (masked). sourceType={}", SourceType.WE_CHAT);
            return null;
        }
        return buildLoginInfo(matchedUser);
    }

    private Users resolveAndBindFromContactUserDetail(String fromUserId, String botId) {
        WecomUserDetail detail;
        try {
            detail = contactUserService.getUserDetail(botId, fromUserId);
        } catch (Exception e) {
            logger.warn("Get WeCom user detail failed; skip auto binding. sourceType={}", SourceType.WE_CHAT, e);
            return null;
        }
        Users matchedUser = findMatchedUserFromDetail(detail);
        if (matchedUser == null) {
            return null;
        }
        saveUserExternalSystem(fromUserId, matchedUser.getUserId(), detail);
        return matchedUser;
    }

    private Users findMatchedUserFromDetail(WecomUserDetail detail) {
        if (detail == null) {
            return null;
        }

        String userid = detail.getUserid();
        if (StringUtils.hasText(userid)) {
            Users matchedByUserCode = userService.findByUserCode(userid);
            if (matchedByUserCode != null) {
                return matchedByUserCode;
            }
        }

        String mobile = detail.getMobile();
        if (StringUtils.hasText(mobile)) {
            Users matchedByMobile = userService.findByUserPhone(mobile);
            if (matchedByMobile != null) {
                return matchedByMobile;
            }
        }

        String email = detail.getEmail();
        if (StringUtils.hasText(email)) {
            Users matchedByEmail = userService.findByEmail(email);
            if (matchedByEmail != null) {
                return matchedByEmail;
            }
        }

        String name = detail.getName();
        if (StringUtils.hasText(name)) {
            List<Users> users = userService.findByUserName(name);
            if (users != null && users.size() == 1) {
                return users.get(0);
            }
        }

        return null;
    }

    public void saveUserExternalSystem(String externalUserId, Long userId, WecomUserDetail userDetail) {
        if (!StringUtils.hasText(externalUserId) || userId == null || userDetail == null) {
            return;
        }

        UserExternalSystem existing = userExternalSystemService.findByUnionId(SourceType.WE_CHAT, externalUserId);
        if (existing != null) {
            existing.setUserId(userId);
            fillExternalSystem(existing, externalUserId, userDetail);
            if (existing.getBindingTime() == null) {
                existing.setBindingTime(new Date());
            }
            userExternalSystemService.update(existing);
            return;
        }

        UserExternalSystem externalSystem = new UserExternalSystem();
        externalSystem.setId(sequenceService.nextVal());
        externalSystem.setUserId(userId);
        externalSystem.setSourceType(SourceType.WE_CHAT);
        externalSystem.setBindingTime(new Date());
        fillExternalSystem(externalSystem, externalUserId, userDetail);
        userExternalSystemService.save(externalSystem);
    }

    private void fillExternalSystem(UserExternalSystem externalSystem,
                                    String externalUserId,
                                    WecomUserDetail userDetail) {
        externalSystem.setUnionId(externalUserId);
        externalSystem.setSourceAccount(userDetail.getUserid());
        externalSystem.setSourceNickname(userDetail.getName());
        externalSystem.setSourceEmail(userDetail.getEmail());
        externalSystem.setSourceDepId(userDetail.getDepartment() == null ? null : userDetail.getDepartment().toString());
    }

    private LoginInfo buildLoginInfo(Users user) {
        LoginInfo loginInfo = new LoginInfo();
        loginInfo.setUserId(user.getUserId());
        loginInfo.setUserCode(user.getUserCode());
        loginInfo.setUserName(user.getUserName());
        loginInfo.setAssistantId(user.getAssistantId());
        loginInfo.setEnterpriseId(enterpriseInfoService.getEnterpriseId());
        SuasSuperassist superassist = suasSuperassistService.findByUserId(user.getUserId());
        if (superassist != null) {
            loginInfo.setSessionDatasetId(superassist.getSessionDatasetId());
            loginInfo.setDefaultDigEmployeeId(superassist.getDefaultDigEmployeeId());
        }
        CurrentUserHolder.setLoginInfo(loginInfo);
        return loginInfo;
    }
}
