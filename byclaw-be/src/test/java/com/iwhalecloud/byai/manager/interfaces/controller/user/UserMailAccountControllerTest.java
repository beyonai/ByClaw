package com.iwhalecloud.byai.manager.interfaces.controller.user;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.doThrow;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.content;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.lang.reflect.Method;
import java.lang.reflect.Parameter;
import java.util.Date;
import java.util.LinkedHashMap;
import java.util.Map;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.DeserializationFeature;
import com.iwhalecloud.byai.manager.application.service.user.UserMailAccountApplicationService;
import com.iwhalecloud.byai.manager.domain.mail.MailConnectionCheckAdmissionService;
import com.iwhalecloud.byai.manager.dto.users.MailConnectionCheckRequestDTO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.vo.users.MailConnectionCheckResultVO;
import com.iwhalecloud.byai.state.infrastructure.exception.GlobalExceptionHandler;
import jakarta.validation.Valid;
import jakarta.validation.constraints.NotNull;
import org.junit.jupiter.api.Test;
import org.springframework.test.util.ReflectionTestUtils;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;

class UserMailAccountControllerTest {

    private static MockMvc mockMvc(UserMailAccountApplicationService service) {
        MailConnectionCheckController controller = new MailConnectionCheckController();
        ReflectionTestUtils.setField(controller, "userMailAccountApplicationService", service);
        return MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new MailConnectionCheckExceptionHandler())
            .build();
    }

    @Test
    void checkReturnsGeneric400ForUnknownSecretFieldMalformedJsonAndInvalidId() throws Exception {
        UserMailAccountApplicationService service = mock(UserMailAccountApplicationService.class);
        MockMvc mvc = mockMvc(service);
        for (String body : new String[] {
            "{\"accountId\":7001,\"token\":\"do-not-log\"}",
            "{\"accountId\":7001,\"authCode\":",
            "{\"accountId\":null}"
        }) {
            mvc.perform(post("/userMailAccount/check").contentType(MediaType.APPLICATION_JSON).content(body))
                .andExpect(status().isBadRequest())
                .andExpect(jsonPath("$.msg").value("Invalid mail connection check request"))
                .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("do-not-log"))));
        }
    }

    @Test
    void checkMapsOwnershipBusyAndInfrastructureFailuresToSafeStatuses() throws Exception {
        UserMailAccountApplicationService service = mock(UserMailAccountApplicationService.class);
        MockMvc mvc = mockMvc(service);
        doThrow(new IllegalArgumentException("owner@example secret")).when(service).check(7001L);
        mvc.perform(post("/userMailAccount/check").contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountId\":7001}"))
            .andExpect(status().isBadRequest())
            .andExpect(jsonPath("$.msg").value("Invalid mail connection check request"));

        doThrow(new MailConnectionCheckAdmissionService.BusyException()).when(service).check(7001L);
        mvc.perform(post("/userMailAccount/check").contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountId\":7001}"))
            .andExpect(status().isConflict())
            .andExpect(jsonPath("$.msg").value("Mail connection check is already running"));

        doThrow(new MailConnectionCheckAdmissionService.UnavailableException()).when(service).check(7001L);
        mvc.perform(post("/userMailAccount/check").contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountId\":7001}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.msg").value("Mail connection check is temporarily unavailable"));

        doThrow(new RuntimeException("database-host=secret")).when(service).check(7001L);
        mvc.perform(post("/userMailAccount/check").contentType(MediaType.APPLICATION_JSON)
                .content("{\"accountId\":7001}"))
            .andExpect(status().isServiceUnavailable())
            .andExpect(jsonPath("$.msg").value("Mail connection check is temporarily unavailable"))
            .andExpect(content().string(org.hamcrest.Matchers.not(org.hamcrest.Matchers.containsString("secret"))));
    }

    @Test
    void nonCheckEndpointRetainsEstablishedExceptionContract() throws Exception {
        UserMailAccountApplicationService service = mock(UserMailAccountApplicationService.class);
        UserMailAccountController controller = new UserMailAccountController();
        ReflectionTestUtils.setField(controller, "userMailAccountApplicationService", service);
        when(service.list()).thenThrow(new RuntimeException("non-check-established-error"));
        MockMvc mvc = MockMvcBuilders.standaloneSetup(controller)
            .setControllerAdvice(new MailConnectionCheckExceptionHandler(), new GlobalExceptionHandler())
            .build();

        mvc.perform(org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get(
                "/userMailAccount/list"))
            .andExpect(status().isInternalServerError())
            .andExpect(jsonPath("$.msg").value("non-check-established-error"))
            .andExpect(content().string(org.hamcrest.Matchers.not(
                org.hamcrest.Matchers.containsString("Mail connection check"))));
    }

    @Test
    void checkEndpointAcceptsOnlyValidatedAccountIdAndDelegatesCurrentUserResolutionToService() throws Exception {
        Method method = MailConnectionCheckController.class.getDeclaredMethod("check", MailConnectionCheckRequestDTO.class);
        assertThat(method.getAnnotation(PostMapping.class).value()).containsExactly("/userMailAccount/check");
        Parameter parameter = method.getParameters()[0];
        assertThat(parameter.isAnnotationPresent(Valid.class)).isTrue();
        assertThat(parameter.isAnnotationPresent(RequestBody.class)).isTrue();
        assertThat(MailConnectionCheckRequestDTO.class.getDeclaredFields()).extracting("name")
            .containsExactly("accountId");
        assertThat(MailConnectionCheckRequestDTO.class.getDeclaredField("accountId").isAnnotationPresent(NotNull.class))
            .isTrue();
    }

    @Test
    void checkRejectsUnknownFrontendFieldsDuringDeserialization() {
        ObjectMapper mapper = new ObjectMapper().disable(DeserializationFeature.FAIL_ON_UNKNOWN_PROPERTIES);
        assertThatThrownBy(() -> mapper.readValue(
            "{\"accountId\":7001,\"userId\":1001,\"provider\":\"qq\",\"command\":\"send\"}",
            MailConnectionCheckRequestDTO.class))
            .hasMessageContaining("Unsupported mail connection check field")
            .hasMessageNotContaining("qq")
            .hasMessageNotContaining("send");
    }

    @Test
    void checkReturnsExactlyFrontendResultShapeWithGenericMessage() throws Exception {
        UserMailAccountApplicationService service = mock(UserMailAccountApplicationService.class);
        MailConnectionCheckController controller = new MailConnectionCheckController();
        ReflectionTestUtils.setField(controller, "userMailAccountApplicationService", service);
        MailConnectionCheckRequestDTO request = new MailConnectionCheckRequestDTO();
        request.setAccountId(7001L);
        MailConnectionCheckResultVO result = new MailConnectionCheckResultVO();
        result.setConnectionState("READY");
        result.setStatus("PARTIAL");
        result.setLastCheckTime(new Date());
        result.setCapabilityStatus(new LinkedHashMap<>(Map.ofEntries(
            Map.entry("list", "YES"),
            Map.entry("get", "YES"),
            Map.entry("search", "CONDITIONAL_SERVER_SEARCH"),
            Map.entry("downloadAttachment", "YES"),
            Map.entry("send", "YES"),
            Map.entry("reply", "YES"),
            Map.entry("delete", "NO"))));
        when(service.check(7001L)).thenReturn(result);

        ResponseUtil<MailConnectionCheckResultVO> response = controller.check(request);

        assertThat(response.getData()).isSameAs(result);
        assertThat(response.getMsg()).doesNotContain("python", "runtime", "network", "server");
        String json = new ObjectMapper().writeValueAsString(response.getData());
        assertThat(json).contains(
            "\"connectionState\":\"READY\"",
            "\"status\":\"PARTIAL\"",
            "\"capabilityStatus\":{\"list\":\"YES\",\"get\":\"YES\","
                + "\"search\":\"CONDITIONAL_SERVER_SEARCH\",\"downloadAttachment\":\"YES\","
                + "\"send\":\"YES\",\"reply\":\"YES\",\"delete\":\"NO\"}"
        ).doesNotContain("messageId", "subject", "sender", "email", "accountId", "auth");
        verify(service).check(7001L);
    }
}
