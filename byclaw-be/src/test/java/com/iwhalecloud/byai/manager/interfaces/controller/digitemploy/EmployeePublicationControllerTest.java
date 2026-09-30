package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeePublicationApplicationService;
import com.iwhalecloud.byai.state.infrastructure.exception.GlobalExceptionHandler;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class EmployeePublicationControllerTest {
    @Test void businessValidationReturns400WithSpecificReasonAndUnexpectedFailuresRemain500() throws Exception {
        var service = mock(EmployeePublicationApplicationService.class);
        var mvc = MockMvcBuilders.standaloneSetup(new EmployeePublicationController(service))
            .setControllerAdvice(new GlobalExceptionHandler()).build();
        when(service.prepare(10L)).thenThrow(new BaseException("仅在用数字员工支持发起发布或更新"));
        mvc.perform(post("/digitalEmployeePublication/prepare").contentType(MediaType.APPLICATION_JSON)
                .content("{\"resourceId\":10}"))
            .andExpect(status().isBadRequest()).andExpect(jsonPath("$.code").value(-1))
            .andExpect(jsonPath("$.msg").value("仅在用数字员工支持发起发布或更新"));
        doThrow(new IllegalStateException("unexpected")).when(service).prepare(10L);
        mvc.perform(post("/digitalEmployeePublication/prepare").contentType(MediaType.APPLICATION_JSON)
                .content("{\"resourceId\":10}"))
            .andExpect(status().isInternalServerError());
    }
}
