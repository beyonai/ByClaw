package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import static org.junit.jupiter.api.Assertions.assertThrows;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.times;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.util.List;
import java.util.Locale;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.iwhalecloud.byai.common.i18n.I18nLocaleResolver;
import com.iwhalecloud.byai.common.i18n.I18nTestSupport;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotConfigService;
import com.iwhalecloud.byai.gateway.channels.service.dingtalk.stream.DingtalkRobotConfigValidationException;
import com.iwhalecloud.byai.manager.application.service.digitemploy.DigitalEmployeeApplicationService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceExtDigEmployeeDto;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.infrastructure.exception.OAuth2ExceptionHandler;
import com.iwhalecloud.byai.state.aspect.ManageLogAspect;
import com.iwhalecloud.byai.state.common.filter.GlobalI18nFilter;
import com.iwhalecloud.byai.state.domain.log.service.ManageLogService;
import com.iwhalecloud.byai.state.infrastructure.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.params.ParameterizedTest;
import org.junit.jupiter.params.provider.CsvSource;
import org.springframework.aop.aspectj.annotation.AspectJProxyFactory;
import org.springframework.http.MediaType;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

class DigitalEmployeeRobotConfigControllerTest extends I18nTestSupport {

    private static final String VALID_ROBOT = """
        {"channel":"DingTalk","robotCode":"robot-1","clientId":"client-1","clientSecret":"secret-1"}
        """;

    private DigitalEmployeeApplicationService service;

    private ManageLogService manageLogService;

    private MockMvc mvc;

    @BeforeEach
    void setUp() {
        service = mock(DigitalEmployeeApplicationService.class);
        DigitalEmployeeController controller = new DigitalEmployeeController();
        ReflectionTestUtils.setField(controller, "digitalEmployeeApplicationService", service);

        // 保存接口经过管理日志切面，必须覆盖异常经过切面后仍能进入本地化处理的真实链路。
        manageLogService = mock(ManageLogService.class);
        ManageLogAspect manageLogAspect = new ManageLogAspect();
        ReflectionTestUtils.setField(manageLogAspect, "manageLogService", manageLogService);
        AspectJProxyFactory proxyFactory = new AspectJProxyFactory(controller);
        proxyFactory.setProxyTargetClass(true);
        proxyFactory.addAspect(manageLogAspect);
        DigitalEmployeeController proxiedController = proxyFactory.getProxy();
        mvc = MockMvcBuilders.standaloneSetup(proxiedController)
            .addFilters(new GlobalI18nFilter())
            .setLocaleResolver(new I18nLocaleResolver())
            .setControllerAdvice(new GlobalExceptionHandler(), new OAuth2ExceptionHandler())
            .build();
    }

    @ParameterizedTest
    @CsvSource(value = {
        "zh-CN|OWNED_BY_ANOTHER_EMPLOYEE|该钉钉 robotCode 已绑定其他数字员工（问数数字员工），不能重复绑定，请更换机器人或先解除原绑定",
        "en-US|OWNED_BY_ANOTHER_EMPLOYEE|This DingTalk robotCode is already bound to another digital employee (问数数字员工). Use a different robot or remove the existing binding first.",
        "zh-CN|OWNED_BY_ANOTHER_EMPLOYEE_WITHOUT_NAME|该钉钉 robotCode 已绑定其他数字员工，不能重复绑定，请更换机器人或先解除原绑定",
        "en-US|OWNED_BY_ANOTHER_EMPLOYEE_WITHOUT_NAME|This DingTalk robotCode is already bound to another digital employee. Use a different robot or remove the existing binding first.",
        "zh-CN|DUPLICATE_ROBOT_CODE|同一数字员工不能重复配置相同的钉钉 robotCode，请删除重复配置",
        "en-US|DUPLICATE_ROBOT_CODE|The same DingTalk robotCode cannot be configured more than once for a digital employee. Remove the duplicate configuration.",
        "zh-CN|MISSING_CREDENTIALS|钉钉机器人配置不完整，请填写 clientId、clientSecret 和 robotCode",
        "en-US|MISSING_CREDENTIALS|Incomplete DingTalk robot configuration. Enter clientId, clientSecret and robotCode.",
        "zh-CN|INVALID_JSON|钉钉机器人配置格式错误，请重新填写机器人配置",
        "en-US|INVALID_JSON|Invalid DingTalk robot configuration format. Enter the robot configuration again."
    }, delimiter = '|')
    void createAndUpdateReturnSpecificLocalizedValidationMessages(String language, String errorType, String expected)
        throws Exception {
        DingtalkRobotConfigValidationException exception = validationException(errorType);
        when(service.updateDigitalEmployee(any())).thenThrow(exception);
        when(service.saveDigitalEmployee(any())).thenThrow(exception);

        assertValidationResponse("updateDigitalEmployee", language, expected);
        assertValidationResponse("saveDigitalEmployee", language, expected);
        verify(manageLogService, times(2)).saveManageLog(any());
    }

    @Test
    void unclassifiedValidationErrorsDoNotExposeInternalDetails() throws Exception {
        when(service.updateDigitalEmployee(any())).thenThrow(
            new DingtalkRobotConfigValidationException("internal diagnostic: clientSecret=private-value"));

        assertValidationResponse("updateDigitalEmployee", "zh-CN", "钉钉机器人配置无效，请检查配置后重试");
        verify(manageLogService).saveManageLog(any());
    }

    @Test
    void otherErrorsKeepExistingManagementLogFailureResponse() throws Exception {
        when(service.updateDigitalEmployee(any())).thenThrow(new IllegalStateException("unexpected failure"));

        mvc.perform(post("/digitalEmployeeController/updateDigitalEmployee")
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"resourceId\":2}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(-1))
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.msg").value("unexpected failure"));
        verify(manageLogService).saveManageLog(any());
    }

    private void assertValidationResponse(String endpoint, String language, String expected) throws Exception {
        mvc.perform(post("/digitalEmployeeController/" + endpoint)
                .header("language", language)
                .locale(Locale.forLanguageTag(language))
                .contentType(MediaType.APPLICATION_JSON)
                .content("{\"resourceId\":2,\"language\":\"" + language + "\"}"))
            .andExpect(status().isOk())
            .andExpect(jsonPath("$.code").value(-1))
            .andExpect(jsonPath("$.success").value(false))
            .andExpect(jsonPath("$.msg").value(expected));
    }

    private DingtalkRobotConfigValidationException validationException(String errorType) {
        DingtalkRobotConfigService configService = new DingtalkRobotConfigService(new ObjectMapper());
        String machineChannel = switch (errorType) {
            case "OWNED_BY_ANOTHER_EMPLOYEE", "OWNED_BY_ANOTHER_EMPLOYEE_WITHOUT_NAME" -> "[" + VALID_ROBOT + "]";
            case "DUPLICATE_ROBOT_CODE" -> "[" + VALID_ROBOT + "," + VALID_ROBOT + "]";
            case "MISSING_CREDENTIALS" -> "[{\"channel\":\"DingTalk\",\"robotCode\":\"robot-1\"}]";
            case "INVALID_JSON" -> "[{";
            default -> throw new IllegalArgumentException("Unsupported test error type: " + errorType);
        };
        if ("OWNED_BY_ANOTHER_EMPLOYEE".equals(errorType)
            || "OWNED_BY_ANOTHER_EMPLOYEE_WITHOUT_NAME".equals(errorType)) {
            ResourceExtDigEmployeeDto owner = employee(1L, machineChannel);
            owner.setResourceName("OWNED_BY_ANOTHER_EMPLOYEE".equals(errorType) ? "问数数字员工" : null);
            configService.refreshRobotConfigs(List.of(owner));
        }

        return assertThrows(DingtalkRobotConfigValidationException.class,
            () -> configService.validateAndBuildRobotConfigs(employee(2L, machineChannel)));
    }

    private ResourceExtDigEmployeeDto employee(Long resourceId, String machineChannel) {
        ResourceExtDigEmployeeDto employee = new ResourceExtDigEmployeeDto();
        employee.setResourceId(resourceId);
        employee.setResourceName("Employee " + resourceId);
        SsResExtDigEmployee extension = new SsResExtDigEmployee();
        extension.setMachineChannel(machineChannel);
        employee.setSsResExtDigEmployee(extension);
        return employee;
    }
}
