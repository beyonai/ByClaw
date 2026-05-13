package com.iwhalecloud.byai.state.aspect;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.application.service.limit.ChatCallLimitService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
/**
 * 聊天调用次数限制切面
 */
@Aspect
@Component
public class ChatCallLimitAspect {

    @Autowired
    private ChatCallLimitService chatCallLimitService;

    @Around("@annotation(com.iwhalecloud.byai.common.annotation.ChatCallLimit)")
    public Object checkCallLimit(ProceedingJoinPoint joinPoint) throws Throwable {
        // 获取用户ID
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null) {
            throw new BdpRuntimeException(I18nUtil.get("user.not.found"));
        }

        // 检查调用限制
        if (!chatCallLimitService.checkAndIncrementCallCount(userId)) {
            throw new BdpRuntimeException(I18nUtil.get("chat.limit.daily.exceeded"));
        }

        return joinPoint.proceed();
    }
}
