package com.iwhalecloud.byai.state.domain.chat.model;

import com.iwhalecloud.byai.state.domain.chat.dto.TaskFileDto;
import lombok.Data;

import java.util.List;

/**
 * 成果空间
 * 用于存储聊天相关的MD和文件等信息
 */
@Data
public class ResultSpace {

    /**
     * MD文件的相关内容
     */
    private String mdContent;

    /**
     * MD文件路径
     */
    private String mdFilePath;

    /**
     * 任务文件列表
     */
    private List<TaskFileDto> taskFileList;

}