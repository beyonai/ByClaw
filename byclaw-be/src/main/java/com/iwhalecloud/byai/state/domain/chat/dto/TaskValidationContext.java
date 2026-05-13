package com.iwhalecloud.byai.state.domain.chat.dto;


import lombok.Data;

import java.util.List;
import java.util.Set;

/**
 * 任务验证上下文
 * 用于存储验证过程中需要的信息
 * @author zht
 * @version 1.0
 * @date 2025/7/19
 */

@Data
public  class TaskValidationContext {
    private MessageTaskDto.TaskSubStep subStep;
    private List<String> stepOrder;
    private Set<String> availableFiles;
}