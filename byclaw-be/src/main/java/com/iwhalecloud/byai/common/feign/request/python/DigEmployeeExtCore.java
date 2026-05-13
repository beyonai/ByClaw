package com.iwhalecloud.byai.common.feign.request.python;

import com.iwhalecloud.byai.common.feign.request.conversation.Agent;
import com.iwhalecloud.byai.common.feign.request.conversation.Dataset;
import com.iwhalecloud.byai.common.feign.request.conversation.McpServer;
import com.iwhalecloud.byai.common.feign.request.conversation.OpenAiToolDto;
import lombok.Getter;
import lombok.Setter;

import java.util.ArrayList;
import java.util.List;

/**
 * @author he.duming
 * @date 2025-12-22 14:59:02
 * @description 数字员工关联扩展属性
 */
@Getter
@Setter
public class DigEmployeeExtCore {

    private List<Agent> agentList = new ArrayList<>();

    private List<Dataset> datasetList = new ArrayList<>();

    private List<OpenAiToolDto> plugTools = new ArrayList<>();

    private List<McpServer> mcpServerList = new ArrayList<>();
}
