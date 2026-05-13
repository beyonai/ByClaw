package com.iwhalecloud.byai.state.domain.chat.dto;

import com.alibaba.fastjson.annotation.JSONField;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import lombok.Data;

import java.util.ArrayList;
import java.util.List;

/**
 * @author zht
 * @version 1.0
 * @date 2025/7/14
 */
@Data
public class MessageTaskDto {

    @JSONField(name = "task_description")
    private String taskDescription;

    @JSONField(name = "steps")
    private List<Step> steps;

    @JSONField(name = "messageId")
    private String messageId;

    @JSONField(name = "files")
    private List<MessageFileDto> files;

    @Data
    public static class Step {

        @JSONField(name = "step_topic")
        private String stepTopic;

        @JSONField(name = "sub_steps")
        private List<TaskSubStep> subSteps;

    }

    @Data
    public static class TaskSubStep {

        @JSONField(name = "id")
        private String id;

        @JSONField(name = "step_name")
        private String stepName;

        /**
         * python必须给默认值空数组
         */
        @JSONField(name = "reference_steps")
        private List<String> referenceSteps = new ArrayList<>();

        @JSONField(name = "step_description")
        private String stepDescription;

        /**
         * python必须给默认值空数组
         */
        @JSONField(name = "input_files")
        private List<String> inputFiles = new ArrayList<>();

        @JSONField(name = "output_path")
        private String outputPath;

        /**
         * python必须给默认值空格
         */
        @JSONField(name = "tool")
        private String tool = "";

        @JSONField(name = "invalidErrors")
        private List<String> invalidErrors;

        @JSONField(name = "updateTag")
        private Boolean updateTag;

        @JSONField(name = "tool_metadata")
        private ToolMetadata toolMetadata;

    }

    @Data
    public static class ToolMetadata {

        @JSONField(name = "toolId")
        private Long toolId;

        @JSONField(name = "toolName")
        private String toolName;

        @JSONField(name = "toolType")
        private String toolType;

        @JSONField(name = "path")
        private String path;

    }
}
