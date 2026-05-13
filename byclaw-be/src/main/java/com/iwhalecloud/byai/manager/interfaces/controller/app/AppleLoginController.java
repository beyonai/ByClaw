package com.iwhalecloud.byai.manager.interfaces.controller.app;

import com.iwhalecloud.byai.manager.application.service.login.AppleLoginService;
import com.iwhalecloud.byai.manager.application.service.login.AppleLoginSessionService;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.manager.entity.users.Users;
import com.iwhalecloud.byai.common.ecrypt.AesUtils;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.common.login.bean.LoginResponse;
import com.iwhalecloud.byai.common.constants.Constants;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.servlet.http.HttpServletRequest;
import org.apache.commons.collections.CollectionUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.List;

/**
 * @description 苹果登录控制器
 * 处理苹果Sign In with Apple的登录请求
 */
@RestController
@RequestMapping("/login/apple")
@Tag(name = "苹果登录", description = "苹果Sign In with Apple登录接口")
public class AppleLoginController {

    private static final Logger logger = LoggerFactory.getLogger(AppleLoginController.class);

    /**
     * 苹果绑定短信类型
     */
    private static final String APPLE_BIND_MSG_TYPE = "4";

    @Autowired
    private AppleLoginService appleLoginService;

    @Autowired
    private AppleLoginSessionService appleLoginSessionService;

    @Autowired
    private SafeAccountMsgService safeAccountMsgService;

    /**
     * 苹果登录验证接口
     *
     * @param identityToken 苹果identity token
     * @param authorizationCode 苹果authorization code（可选）
     * @return 登录结果
     */
    @PostMapping("/verify")
    @Operation(summary = "验证苹果登录", description = "验证苹果Sign In with Apple的identity token")
    public ResponseUtil<AppleLoginService.AppleUserInfo> verifyAppleLogin(
            @Parameter(description = "苹果identity token", required = true)
            @RequestParam String identityToken,
            @Parameter(description = "苹果authorization code", required = false)
            @RequestParam(required = false) String authorizationCode) {

        try {
            if (StringUtil.isEmpty(identityToken)) {
                return ResponseUtil.fail(I18nUtil.get("applelogincontroller.identity_token.required"));
            }

            // 验证苹果identity token
            AppleLoginService.AppleUserInfo userInfo = appleLoginService.verifyIdentityToken(identityToken);

            logger.info("苹果登录验证成功: userId={}, email={}", userInfo.getUserId(), userInfo.getEmail());

            return ResponseUtil.success(userInfo);

        } catch (Exception e) {
            logger.error("苹果登录验证失败", e);
            return ResponseUtil.fail(I18nUtil.get("applelogincontroller.verify.failed") + ": " + e.getMessage());
        }
    }

    /**
     * 获取苹果公钥接口（用于前端调试）
     *
     * @return 苹果公钥信息
     */
    @GetMapping("/public-keys")
    @Operation(summary = "获取苹果公钥", description = "获取苹果Sign In with Apple的公钥信息（用于调试）")
    public ResponseUtil<String> getApplePublicKeys() {
        try {
            // 这里应该调用苹果的公钥API
            // 暂时返回提示信息
            String info = "苹果公钥需要从 https://appleid.apple.com/auth/keys 获取";
            return ResponseUtil.success(info);
        } catch (Exception e) {
            logger.error("获取苹果公钥失败", e);
            return ResponseUtil.fail("获取苹果公钥失败: " + e.getMessage());
        }
    }

    /**
     * 绑定苹果账号到已有用户
     * 通过手机号+验证码验证用户身份，然后绑定苹果账号
     * 绑定成功后直接创建登录会话，无需重新登录
     *
     * @param request HTTP请求
     * @param phone 手机号
     * @param verifyCode 短信验证码
     * @param bindToken 苹果绑定Token
     * @return 登录响应（包含sessionId、token等，可直接进入系统）
     */
    @PostMapping("/bind/existing")
    @Operation(summary = "绑定苹果账号到已有用户", 
               description = "通过手机号+验证码验证身份，将苹果账号绑定到已有用户，绑定成功后直接登录")
    public LoginResponse bindToExistingUser(
            HttpServletRequest request,
            @Parameter(description = "手机号", required = true)
            @RequestParam String phone,
            @Parameter(description = "短信验证码", required = true)
            @RequestParam String verifyCode,
            @Parameter(description = "苹果绑定Token", required = true)
            @RequestParam String bindToken) {

        try {
            // 参数校验
            if (StringUtil.isEmpty(phone)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.phone.required"));
            }
            if (StringUtil.isEmpty(verifyCode)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.verifycode.required"));
            }
            if (StringUtil.isEmpty(bindToken)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.token.required"));
            }

            // 验证短信验证码
            String validationResult = validateSmsCode(phone, verifyCode);
            if (validationResult != null) {
                return LoginResponse.fail(validationResult);
            }

            phone = decodePhone(phone);

            // 绑定苹果账号到已有用户
            Users user = appleLoginService.bindAppleUserToExistingUser(phone, bindToken);

            logger.info("苹果账号绑定到已有用户成功: userId={}, phone={}", user.getUserId(), phone);

            // 检查用户有效性
            String checkResult = appleLoginSessionService.checkUserValid(user);
            if (StringUtil.isNotEmpty(checkResult)) {
                return LoginResponse.fail(checkResult);
            }

            // 创建登录会话并返回登录响应
            return appleLoginSessionService.createLoginSession(request, user);

        } catch (Exception e) {
            logger.error("苹果账号绑定到已有用户失败", e);
            return LoginResponse.fail(I18nUtil.get("apple.bind.failed") + ": " + e.getMessage());
        }
    }

    /**
     * 注册新用户并绑定苹果账号
     * 通过手机号+验证码+用户名注册新用户，然后绑定苹果账号
     * 注册成功后直接创建登录会话，无需重新登录
     *
     * @param request HTTP请求
     * @param phone 手机号
     * @param verifyCode 短信验证码
     * @param userName 用户名
     * @param bindToken 苹果绑定Token
     * @return 登录响应（包含sessionId、token等，可直接进入系统）
     */
    @PostMapping("/bind/register")
    @Operation(summary = "注册新用户并绑定苹果账号", 
               description = "通过手机号+验证码+用户名注册新用户，同时绑定苹果账号，注册成功后直接登录")
    public LoginResponse registerAndBind(
            HttpServletRequest request,
            @Parameter(description = "手机号", required = true)
            @RequestParam String phone,
            @Parameter(description = "短信验证码", required = true)
            @RequestParam String verifyCode,
            @Parameter(description = "用户名", required = true)
            @RequestParam String userName,
            @Parameter(description = "苹果绑定Token", required = true)
            @RequestParam String bindToken) {

        try {
            // 参数校验
            if (StringUtil.isEmpty(phone)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.phone.required"));
            }
            if (StringUtil.isEmpty(verifyCode)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.verifycode.required"));
            }
            if (StringUtil.isEmpty(userName)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.username.required"));
            }
            if (StringUtil.isEmpty(bindToken)) {
                return LoginResponse.fail(I18nUtil.get("apple.bind.token.required"));
            }

            // 验证短信验证码
            String validationResult = validateSmsCode(phone, verifyCode);
            if (validationResult != null) {
                return LoginResponse.fail(validationResult);
            }

            // 明文phone
            phone = decodePhone(phone);

            // 注册新用户并绑定苹果账号
            Users user = appleLoginService.registerAndBindAppleUser(phone, userName, bindToken);

            logger.info("新用户注册并绑定苹果账号成功: userId={}, phone={}", user.getUserId(), phone);

            // 检查用户有效性
            String checkResult = appleLoginSessionService.checkUserValid(user);
            if (StringUtil.isNotEmpty(checkResult)) {
                return LoginResponse.fail(checkResult);
            }

            // 创建登录会话并返回登录响应
            return appleLoginSessionService.createLoginSession(request, user);

        } catch (Exception e) {
            logger.error("新用户注册并绑定苹果账号失败", e);
            return LoginResponse.fail(I18nUtil.get("apple.register.bind.failed") + ": " + e.getMessage());
        }
    }

    /**
     * 验证绑定Token是否有效
     *
     * @param bindToken 苹果绑定Token
     * @return 验证结果
     */
    @PostMapping("/bind/verify-token")
    @Operation(summary = "验证苹果绑定Token", description = "验证苹果绑定Token是否有效")
    public ResponseUtil<AppleLoginService.AppleUserInfo> verifyBindToken(
            @Parameter(description = "苹果绑定Token", required = true)
            @RequestParam String bindToken) {

        try {
            if (StringUtil.isEmpty(bindToken)) {
                return ResponseUtil.fail(I18nUtil.get("apple.bind.token.required"));
            }

            AppleLoginService.AppleUserInfo appleUserInfo = appleLoginService.verifyBindToken(bindToken);
            if (appleUserInfo == null) {
                return ResponseUtil.fail(I18nUtil.get("apple.bindtoken.expired"));
            }

            return ResponseUtil.success(appleUserInfo);

        } catch (Exception e) {
            logger.error("验证苹果绑定Token失败", e);
            return ResponseUtil.fail(I18nUtil.get("apple.bindtoken.verify.failed") + ": " + e.getMessage());
        }
    }

    /**
     * 验证短信验证码
     *
     * @param phone 手机号
     * @param verifyCode 验证码
     * @return 验证失败返回错误消息，成功返回null
     */
    private String validateSmsCode(String phone, String verifyCode) {
        // 加密验证码
        String ssmCodeMd5 = Sm4Util.encrypt(verifyCode);

        phone = decodePhone(phone);

        // 查询未过期的验证码
        List<SafeAccountMsg> safeAccountMsgs = safeAccountMsgService.qryLastByPhone(phone, APPLE_BIND_MSG_TYPE);

        // 如果没有找到验证码记录，尝试使用登录类型的验证码
        if (CollectionUtils.isEmpty(safeAccountMsgs)) {
            safeAccountMsgs = safeAccountMsgService.qryLastByPhone(phone, Constants.LOGIN);
        }

        // 验证码不存在或已过期
        if (CollectionUtils.isEmpty(safeAccountMsgs)) {
            return I18nUtil.get("login.phone.verify.code.expired");
        }

        // 验证码是否正确
        SafeAccountMsg msg = safeAccountMsgs.get(0);
        if (!msg.getVerifyCode().equals(ssmCodeMd5)) {
            return I18nUtil.get("login.phone.verify.code.incorrect");
        }

        // 标记验证码已使用
        for (SafeAccountMsg safeAccountMsg : safeAccountMsgs) {
            safeAccountMsg.setState(SafeAccountMsg.STATE_EXPIRED);
            safeAccountMsgService.update(safeAccountMsg);
        }

        return null;
    }

    /**
     * 解密手机号
     */
    private String decodePhone(String accountCode) {
        try {
            byte[] key = AesUtils.AES_KEY.getBytes(StandardCharsets.UTF_8);
            byte[] enbytes = Base64.getDecoder().decode(accountCode.getBytes(StandardCharsets.UTF_8));
            return new String(AesUtils.decrypt(new String(enbytes, StandardCharsets.UTF_8), key),
                    StandardCharsets.UTF_8);
        }
        catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
        return null;
    }
}