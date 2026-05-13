package com.iwhalecloud.byai.state.aspect;


import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import java.lang.reflect.Method;
import java.util.ArrayList;
import java.util.Date;
import java.util.List;
import com.alibaba.fastjson.JSON;
import com.iwhalecloud.byai.manager.entity.log.ManageLog;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.util.IpUtil;
import com.iwhalecloud.byai.state.domain.log.service.ManageLogService;
import com.iwhalecloud.byai.common.log.exception.BaseRuntimeException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.annotation.Pointcut;
import org.aspectj.lang.reflect.MethodSignature;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import jakarta.servlet.http.HttpServletRequest;

/**
 * 管理日志切面
 */
@Aspect
@Component
public class ManageLogAspect {

    private static final Logger logger = LoggerFactory.getLogger(ManageLogAspect.class);


    @Autowired
    private ManageLogService manageLogService;

    /**
     * 定义ManageLogAop的切入点为标记@ManageLog注解的方法
     */
    @Pointcut(value = "@annotation(com.iwhalecloud.byai.common.annotation.ManageLogAnnotation)")
    public void pointcut() {
    }

    /**
     * 业务操作环绕通知
     *
     * @param proceedingJoinPoint 切面
     * @return 返回参数
     */
    @Around("pointcut()")
    public Object around(ProceedingJoinPoint proceedingJoinPoint) {

        Object reponseParameters = null;

        try {
            reponseParameters = proceedingJoinPoint.proceed(proceedingJoinPoint.getArgs());
            return reponseParameters;
        }

        catch (Throwable e) {
            logger.error(e.getMessage(), e);
            throw new BaseRuntimeException(e.getMessage());
        }
        finally {
            try {
                this.addManageLog(proceedingJoinPoint, reponseParameters);
            }
            catch (Exception e) {
                logger.error(e.getMessage(), e);
            }
        }
    }

    /**
     * 增加操作日志记录
     * 
     * @param proceedingJoinPoint 切面信息
     * @param reposeParameters 响应参数
     * @throws NoSuchMethodException 没此方法异常
     * @throws SecurityException 安全异常
     */
    private void addManageLog(ProceedingJoinPoint proceedingJoinPoint, Object reposeParameters)
        throws NoSuchMethodException, SecurityException {

        MethodSignature mthodSignature = (MethodSignature) proceedingJoinPoint.getSignature();
        Object target = proceedingJoinPoint.getTarget();
        String method = mthodSignature.getName();
        Class[] parameterTypes = mthodSignature.getParameterTypes();
        Method currentMethod = target.getClass().getMethod(method, parameterTypes);
        ManageLogAnnotation operateLogAnnotation = currentMethod.getAnnotation(ManageLogAnnotation.class);

        // 读取方法的入参
        Object[] args = proceedingJoinPoint.getArgs();

        // 创建领域模型
        ManageLog manageLog = new ManageLog();

        // 如果添加了注解，把注解上面的操作描述记录下来
        if (operateLogAnnotation != null) {
            manageLog.setModuleName(operateLogAnnotation.name());
            manageLog.setModuleDescription(operateLogAnnotation.description());
        }

        manageLog.setOperatorUserId(CurrentUserHolder.getCurrentUserId());
        manageLog.setOperatorUserName(CurrentUserHolder.getCurrentUserName());
        manageLog.setIpFrom(IpUtil.getIpAddress(this.getHttpServletRequest()));
        manageLog.setOperatorTime(new Date());
        manageLog.setClassName(mthodSignature.getDeclaringTypeName());
        manageLog.setMethod(method);

        // 入参记录
        if (args != null && args.length > 0) {
            manageLog.setOperatorParam(JSON.toJSONString(this.filter(args)));
        }
        // 出参记录
        if (reposeParameters != null) {
            manageLog.setOperatorResponse(JSON.toJSONString(reposeParameters));
        }

        // 保存日志
        manageLogService.saveManageLog(manageLog);

    }

    /**
     * 过滤不能序列化的对象
     * 
     * @param args 入参
     * @return List<Object>
     */
    private List<Object> filter(Object[] args) {
        List<Object> filetList = new ArrayList<>(10);
        for (Object obj : args) {
            if (obj instanceof ServletRequest || obj instanceof ServletResponse || obj instanceof MultipartFile) {
                continue;
            }
            filetList.add(obj);
        }
        return filetList;
    }

    /**
     * 获取当前请求对象
     * 
     * @return HttpServletRequest
     */
    private HttpServletRequest getHttpServletRequest() {
        return ((ServletRequestAttributes) RequestContextHolder.getRequestAttributes()).getRequest();
    }
}
