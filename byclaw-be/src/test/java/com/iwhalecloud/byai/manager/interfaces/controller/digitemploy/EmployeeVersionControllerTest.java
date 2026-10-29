package com.iwhalecloud.byai.manager.interfaces.controller.digitemploy;

import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.manager.application.service.digitemploy.EmployeeVersionCommands;
import org.junit.jupiter.api.Test;
import org.springframework.http.MediaType;
import org.springframework.test.web.servlet.setup.MockMvcBuilders;

import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.*;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.*;

class EmployeeVersionControllerTest {
    @Test void savingFailurePreservesThePartialSuccessReason() throws Exception {
        var commands = mock(EmployeeVersionCommands.class);
        when(commands.save(any())).thenThrow(new BaseException("版本已保存，但生效未完成：资源 weather 不可使用"));
        var mvc = MockMvcBuilders.standaloneSetup(new EmployeeVersionController(commands)).build();
        mvc.perform(post("/digitalEmployeeVersions/save").contentType(MediaType.APPLICATION_JSON)
            .content("{\"resourceId\":10,\"expectedRevision\":2,\"requestId\":\"test\"}"))
            .andExpect(status().isOk()).andExpect(jsonPath("$.code").value(-1))
            .andExpect(jsonPath("$.msg").value("版本已保存，但生效未完成：资源 weather 不可使用"));
    }
}
