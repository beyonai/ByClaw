package com.iwhalecloud.byai.state.domain.chat.dto;

import lombok.Data;

import java.util.List;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/14
 */
@Data
public class MessageTaskValidResultDto {

    private String result;

    private MessageTaskDto task;

    private List<InvalidSteps> invalidSteps;

    private String updateDesc;

    @Data
    public static class InvalidSteps {
        private String id;
        private String updateDesc;
    }
}
