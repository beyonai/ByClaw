package com.iwhalecloud.byai.state.domain.chat.dto;

import com.iwhalecloud.byai.state.domain.session.dto.SessionMembersDto;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

import com.fasterxml.jackson.annotation.JsonIgnore;
import com.iwhalecloud.byai.manager.entity.session.ByaiSessionExt;
import com.iwhalecloud.byai.common.constants.men.TaskOperateTypeEnum;
import com.iwhalecloud.byai.state.domain.chat.model.MessageFileDto;
import com.iwhalecloud.byai.state.domain.resource.dto.ResourceVo;
import io.netty.channel.Channel;
import io.swagger.v3.oas.annotations.media.Schema;
import lombok.Data;
import lombok.Getter;
import lombok.Setter;

@Getter
@Setter
@Data
@Schema(description = "数字助理对话请求参数")
public class AssistantChatDto {

    /**
     * agentType配套使用，这种情况是指定了智能体回答的场景
     */
    @Schema(description = "智能体ID")
    private Long agentId;

    // AGENT("agent","001","${APP_AGENT_URL}"),
    // // 文档问答类智能体
    // DOC_AGENT("doc_agent","006","${APP_AGENT_URL}"),
    // // 数据问答类智能体
    // DB_AGENT("db_agent","007","${APP_AGENT_URL}"),
    // // 插件类智能体
    // API_AGENT("api_agent","005","${APP_AGENT_URL}"),
    // // chatbi
    // CHATBI("chatbi","002",""),
    // // 写作
    // WRITER("writer","003",""),
    // // 数字人
    // DIGHUM("dighum","004",""),
    // // mcp服务
    // MCP_AGENT("mcpagent","008","");
    @Schema(description = "智能体类型", allowableValues = {
        "001", "006", "007", "005", "002", "003", "004", "008"
    })
    private String agentType;

    /**
     * 会话内容
     */
    @Schema(description = "会话内容", example = "你好，请帮我分析一下这个数据")
    private String chatContent;

    /**
     * 文件内容
     */
    private List<MessageFileDto> files;

    /**
     * 使用回答的模型(用户选择)
     */
    @Schema(description = "使用的模型ID(用户选择)", example = "1")
    private Long relModelId;

    /**
     * 是否搜索企业资料
     */
    @Schema(description = "是否搜索企业资料", example = "false")
    private Boolean enterpriseInformation = false;

    /**
     * 是否深度思考
     */
    @Schema(description = "是否深度思考", example = "false")
    private Boolean deepThink = false;

    @Schema(description = "是否百应智办", example = "false")
    private Boolean smartOffice = false;

    @Schema(description = "任务操作", example = "UPDATE/EXECUTE/RERUN/FEEDBACK")
    private TaskOperateTypeEnum taskOperateType;

    @Schema(description = "任务步骤id", example = "xxfdd")
    private String taskStepId;

    private String mode;

    /**
     * 会话id（改一下） 可传可不传 不传的情况下第一次需要返回sessionId和sessionName
     */
    @Schema(description = "会话ID，首次对话可不传，系统会返回新的sessionId和sessionName", example = "345678")
    private Long sessionId;

    /**
     * 会话id（改一下）
     */
    @Schema(description = "扩展参数(问数,慧笔，鲸灵专用)", example = "{\"key\": \"value\"}")
    private Map<String, Object> extParams = new HashMap<>();

    @Schema(description = "是否网络联网检索", example = "false")
    private boolean connectNet = false;

    @Schema(description = "消息来源端", example = "Web,APP,DingDing")
    private String accessTerminal = "Web";

    /**
     * 消息渠道扩展属性（键值均为字符串），例如钉钉会话 ID；非空时会合并进 Gateway 下发消息的 metadata。
     */
    @Schema(description = "消息渠道扩展属性（字符串键值对），如钉钉 conversationId、conversationType 等")
    private Map<String, String> channelExtension;

    @Schema(description = "回复对象的id", example = "345678")
    private Long ResobjId;

    @Schema(description = "回复对象类型HUMAN/AGENT/ASSISTANT", example = "345678")
    private String ResObjType;

    @Schema(description = "模型回复消息id", example = "345678")
    private Long llmMessageId;

    /**
     * 智能体编码
     */
    @Schema(description = "智能体编码")
    private String agentCode;

    /**
     * 资源列表
     */
    @Schema(description = "资源列表")
    private List<ResourceVo> resourceList = new ArrayList<>();

    /**
     * 会话类型 h_as：人与超级助手/数字员工单聊 hs_as：群聊 h_h：人与人单聊
     */
    @Schema(description = "会话类型")
    private String sessionType;

    @Schema(description = "会话信息")
    private String metadata;

    @Schema(description = "超级助手id，外部超级助手需要传此id")
    private Long assistantId;

    /**
     * 是否debug
     */
    private Integer isDebug = 0;

    /**
     * 页面传入的datacloud配置
     */
    private ChatDataCloudQo dataCloud;

    /**
     * 页面传入的functioncloud配置
     */
    private ChatFunctionCloudQo functionCloud;

    /**
     * 记忆相关
     */
    private MemoryDto memory;

    private SessionMembersDto session;

    /**
     * 扩展属性
     */
    private List<ByaiSessionExt> sessionExts;

    /**
     * 是否开启录音
     */
    private boolean record;

    /**
     * 发送请求的 WebSocket Channel，用于多端广播时排除发送端，不参与序列化
     */
    @JsonIgnore
    private transient Channel senderChannel;

    /**
     * user ActionType: see @com.iwhaleai.byai.framework.core.protocol.ActionType
     */
    private String actionType;

    /**
     * 当遇到ASK USER暂停，用户补充信息再次发送时，需要传入，用于表达是从哪个agent暂停的
     */
    private String sourceAgentType;

}
