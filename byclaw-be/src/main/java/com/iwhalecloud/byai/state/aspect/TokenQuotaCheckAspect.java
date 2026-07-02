package com.iwhalecloud.byai.state.aspect;

import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

import com.iwhalecloud.byai.state.application.service.limit.TokenQuotaService;
import com.iwhalecloud.byai.state.common.exception.BdpRuntimeException;
import com.iwhalecloud.byai.state.domain.chat.dto.AssistantChatDto;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import lombok.extern.slf4j.Slf4j;

/**
 * Token 月度限额检查切面
 * 对话请求前检查用户本月公共模型 Token 是否已超限
 * 仅对公共模型和 TokenSaver 模型生效，自购个人模型不受限
 */
@Slf4j
@Aspect
@Component
public class TokenQuotaCheckAspect {

    @Autowired
    private TokenQuotaService tokenQuotaService;

    @Around("@annotation(com.iwhalecloud.byai.common.annotation.TokenQuotaCheck)")
    public Object checkTokenQuota(ProceedingJoinPoint joinPoint) throws Throwable {
        Long userId = CurrentUserHolder.getCurrentUserId();
        if (userId == null) {
            throw new BdpRuntimeException(I18nUtil.get("user.not.found"));
        }

        try {
            // 从方法参数中获取数字员工资源ID，判断其模型是否受限额约束
            Long resourceId = extractAgentId(joinPoint);
            if (!tokenQuotaService.isModelSubjectToQuota(resourceId)) {
                return joinPoint.proceed();
            }

            if (tokenQuotaService.isQuotaExceeded(userId)) {
                throw new BdpRuntimeException(I18nUtil.get("token.quota.monthly.exceeded"));
            }
        } catch (BdpRuntimeException e) {
            throw e;
        } catch (Exception e) {
            log.warn("Token quota check failed, allowing request: {}", e.getMessage());
        }

        return joinPoint.proceed();
    }

    private Long extractAgentId(ProceedingJoinPoint joinPoint) {
        for (Object arg : joinPoint.getArgs()) {
            if (arg instanceof AssistantChatDto dto) {
                return dto.getAgentId();
            }
        }
        return null;
    }
}
