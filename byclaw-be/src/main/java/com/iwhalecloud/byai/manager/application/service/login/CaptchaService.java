package com.iwhalecloud.byai.manager.application.service.login;

import java.nio.charset.StandardCharsets;
import java.util.Base64;
import java.util.Date;
import java.util.List;
import java.util.concurrent.ThreadLocalRandom;
import java.util.concurrent.TimeUnit;
import com.iwhalecloud.byai.manager.domain.login.model.ValidateCode;
import com.iwhalecloud.byai.manager.domain.login.service.SafeAccountMsgService;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.common.util.IpUtil;
import com.iwhalecloud.byai.common.util.RedisUtil;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import com.baomidou.mybatisplus.core.toolkit.CollectionUtils;
import com.iwhalecloud.byai.manager.entity.login.SafeAccountMsg;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.infrastructure.config.SmsRateLimitConfig;
import com.iwhalecloud.byai.manager.infrastructure.sms.AliyunSmsService;
import com.iwhalecloud.byai.manager.dto.auth.SmsCaptchaRequest;
import com.iwhalecloud.byai.common.ecrypt.AesUtils;
import com.iwhalecloud.byai.common.ecrypt.Sm4Util;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import jakarta.servlet.http.HttpServletRequest;
import jakarta.servlet.http.HttpServletResponse;
import jakarta.servlet.http.HttpSession;

@Service
public class CaptchaService {

    public static final Logger LOGGER = LoggerFactory.getLogger(CaptchaService.class);

    private static final String CAPTCHA_SESSION_KEY = "VERIFICATION_CODE";

    private static final String CAPTCHA_SESSION_DATE = "KAPTCHA_SESSION_DATE";

    private static final int CAPTCHA_EXPIRE_MINUTES = 2;

    private static final String SMS_IP_COUNT_KEY = "sms:ip:type:count:";

    @Autowired
    private AliyunSmsService smsService;

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SafeAccountMsgService safeAccountMsgService;

    @Autowired
    private SmsRateLimitConfig smsRateLimitConfig;

    /**
     * 生成图形验证码
     */
    public void generateImageCaptcha(HttpSession session, HttpServletResponse response) {
        try {
            response.setContentType("image/png");
            response.setHeader("Pragma", "No-cache");
            response.setHeader("Cache-Control", "no-cache");
            session.removeAttribute(CAPTCHA_SESSION_KEY);

            // 生成4位数字验证码
            ValidateCode vCode = new ValidateCode(65, 20, 4, 15);
            session.setAttribute(CAPTCHA_SESSION_KEY, vCode.getCode());
            session.setAttribute(CAPTCHA_SESSION_DATE, System.currentTimeMillis());

            // 输出图片
            vCode.write(response.getOutputStream());
        }
        catch (Exception e) {
            throw new BaseException("captcha.image.generate.failed", e);
        }
    }

    /**
     * 验证图形验证码
     */
    public void validateImageCaptcha(HttpSession session, String captchaCode) {

        String sessionCode = (String) session.getAttribute(CAPTCHA_SESSION_KEY);
        Long generateTime = (Long) session.getAttribute(CAPTCHA_SESSION_DATE);

        if (sessionCode == null || generateTime == null) {
            throw new BaseException(I18nUtil.get("captcha.image.invalid"));
        }

        if (System.currentTimeMillis() - generateTime > CAPTCHA_EXPIRE_MINUTES * 60 * 1000) {
            session.removeAttribute(CAPTCHA_SESSION_KEY);
            session.removeAttribute(CAPTCHA_SESSION_DATE);
            throw new BaseException(I18nUtil.get("captcha.image.expired"));
        }

        // 清除session中的验证码
        session.removeAttribute(CAPTCHA_SESSION_KEY);
        session.removeAttribute(CAPTCHA_SESSION_DATE);

        if (!sessionCode.equalsIgnoreCase(captchaCode)) {
            throw new BaseException(I18nUtil.get("captcha.image.incorrect"));
        }
    }

    /**
     * 发送短信验证码
     *
     * @param param 前端加密的手机号(用于数据库查询)
     * @param request 消息类型：1-登录，2-注册
     * @return 是否发送成功
     */
    public boolean sendSmsCode(SmsCaptchaRequest param, HttpServletRequest request) {

        // 校验图形验证码
        validateImageCaptcha(request.getSession(), param.getCaptcha());

        String encryptedPhone = param.getPhone();
        String msgType = param.getBizType();
        String realPhone = this.decodePhone(encryptedPhone);

        // 检查是否重复发送
        this.judgeRepeatedMsg(realPhone, msgType);

        // 检查IP发送频率
        String ip = IpUtil.getIpAddress(request);
        checkSmsLimit(ip, msgType);

        String smsCode = generateRandomCode();
        SafeAccountMsg newMsg = new SafeAccountMsg();
        newMsg.setPhone(realPhone);
        newMsg.setVerifyCode(Sm4Util.encrypt(smsCode));
        newMsg.setMsgType(msgType);

        Date now = new Date();
        newMsg.setMsgId(SequenceService.nextVal());
        newMsg.setCreateDate(now);
        newMsg.setEffectiveMinutes(smsRateLimitConfig.getSmsExpireTime());
        newMsg.setSendDate(now);
        newMsg.setExpireDate(DateUtils.addMinute(now, smsRateLimitConfig.getSmsExpireTime()));
        String templateType = "1".equals(msgType) ? "login" : "register";

        boolean sendResult = smsService.sendSms(realPhone, smsCode, templateType);
        newMsg.setState(sendResult ? SafeAccountMsg.STATE_SEND_SUCCESS : SafeAccountMsg.STATE_SEND_FAIL);

        safeAccountMsgService.save(newMsg);

        if (sendResult) {
            // 更新IP发送记录
            updateSmsRecord(ip);
        }

        return sendResult;

    }

    private void judgeRepeatedMsg(String phone, String msgType) {

        int repeatedInterval = smsRateLimitConfig.getRepeatedInterval();
        List<SafeAccountMsg> safeAccountMsgList = safeAccountMsgService.qryInterval(phone, msgType, repeatedInterval);

        if (CollectionUtils.isNotEmpty(safeAccountMsgList)) {
            throw new BaseException("captcha.sms.repeat.send");
        }
    }

    /**
     * 生成6位随机验证码
     */
    private String generateRandomCode() {
        return String.format("%06d", ThreadLocalRandom.current().nextInt(1000000));
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
            LOGGER.error(e.getMessage(), e);
        }
        return null;
    }

    /**
     * 检查IP发送频率
     */
    private void checkSmsLimit(String ip, String msgType) {
        String countKey = SMS_IP_COUNT_KEY + ip + ":" + msgType;
        String count = RedisUtil.getString(countKey);
        if (count != null && Integer.parseInt(count) >= smsRateLimitConfig.getMaxCount()) {
            throw new BaseException(I18nUtil.get("sms.send.too.frequent"));
        }
    }

    /**
     * 更新IP发送记录
     */
    private void updateSmsRecord(String ip) {
        String countKey = SMS_IP_COUNT_KEY + ip;
        String count = RedisUtil.getString(countKey);
        if (count == null) {
            // 设置初始次数为1，并设置时间窗口后过期
            RedisUtil.setString(countKey, "1", smsRateLimitConfig.getIntervalMinutes(), TimeUnit.MINUTES);
        }
        else {
            // 增加计数
            RedisUtil.increment(countKey);
        }
    }

}
