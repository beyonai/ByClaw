package com.iwhalecloud.byai.manager.application.runner;

import com.alibaba.fastjson2.JSON;
import com.iwhalecloud.byai.common.feign.client.FeignDataCloudService;
import com.iwhalecloud.byai.common.feign.request.datacloud.SubmitWorkspaceTemplateReq;
import com.iwhalecloud.byai.common.feign.response.DataCloudResponse;
import com.iwhalecloud.byai.common.feign.response.datacloud.TemplateSubmitResp;
import com.iwhalecloud.byai.common.jwt.JwtService;
import com.iwhalecloud.byai.common.login.bean.LoginInfo;
import com.iwhalecloud.byai.manager.application.service.login.LoginApplicationService;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.core.Ordered;
import org.springframework.core.annotation.Order;
import org.springframework.stereotype.Component;

import java.util.HashMap;
import java.util.Map;

@Component
@Order(Ordered.LOWEST_PRECEDENCE)
public class InitDatacloudWorkspaceTemplate implements ApplicationRunner {

    private final Logger logger = LoggerFactory.getLogger(InitDatacloudWorkspaceTemplate.class);

    @Autowired
    private JwtService jwtService;

    @Autowired
    private FeignDataCloudService feignDataCloudService;

    @Autowired
    private LoginApplicationService loginApplicationService;

    /**
     * 调用 DataCloud 提交工作空间模板，初始化本体。
     */
    @Override
    public void run(ApplicationArguments args) throws Exception {
        try {

            Map<String, String> headers = new HashMap<>();
            headers.put("Content-Type", "application/json");
            headers.put("X-User-Code", "adminvip");
            LoginInfo loginInfo = loginApplicationService.getLoginInfo("adminvip");
            headers.put("Beyond-Token", jwtService.createJwt(loginInfo));

            SubmitWorkspaceTemplateReq submitTemplateReq = new SubmitWorkspaceTemplateReq();
            submitTemplateReq.setPersonal(false);
            submitTemplateReq.setSqlite(false);
            submitTemplateReq.setReuseTargetTables(true);
            submitTemplateReq.setConfirmDropTargetTables(false);
            logger.info("初始化DataCloud本体请求:{}", JSON.toJSONString(submitTemplateReq));
            DataCloudResponse<TemplateSubmitResp> dataCloudResponse = feignDataCloudService
                .submitWorkspaceTemplates(submitTemplateReq, headers);
            logger.info("初始化DataCloud本体返回:{}", JSON.toJSONString(dataCloudResponse));
        } catch (Exception e) {
            logger.error(e.getMessage(), e);
        }
    }
}
