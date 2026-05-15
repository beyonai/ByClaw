package com.iwhalecloud.byai.manager.entity.resource;

import com.baomidou.mybatisplus.annotation.TableId;
import com.baomidou.mybatisplus.annotation.TableName;
import com.fasterxml.jackson.databind.annotation.JsonSerialize;
import com.fasterxml.jackson.databind.annotation.JsonDeserialize;
import com.fasterxml.jackson.databind.ser.std.ToStringSerializer;
import com.iwhalecloud.byai.common.json.StringOrArrayToJsonStringDeserializer;
import lombok.Getter;
import lombok.Setter;

/**
 * 数字员工扩展信息表
 */
@Getter
@Setter
@TableName("ss_res_ext_dig_employee")
public class SsResExtDigEmployee {

    /**
     * 数字资源标识
     */
    @TableId(value = "resource_id")
    @JsonSerialize(using = ToStringSerializer.class)
    private Long resourceId;

    /**
     * 智能体类型：001 agent（综合类智能体）、002 api_agent（流程操作类智能体）、 003 doc_agent（文档问答类智能体）、004 db_agent（数据问答类智能体）
     */
    private String agentType;

    /**
     * 智能体开发类型：byai/bot/dify/whaleAgent
     */
    private String agentDevType;

    /**
     * 服务对接地址头信息（JSON格式）
     */
    private String agentSseHead;

    /**
     * 对话对接地址
     */
    private String agentSseUrl;

    /**
     * 页面对接地址
     */
    private String agentWebUrl;

    /**
     * 管理页面地址
     */
    private String agentAdminUrlList;

    /**
     * 数字员工配置（JSON格式，包含modelInfo、descText等）
     */
    private String prologue;

    /**
     * 首页地址
     */
    private String agentHomeUrl;

    /**
     * 主页类型，default:默认模板，custom:自定义模板
     */
    private String homeType;

    /**
     * 服务对接原始地址
     */
    private String agentSseUrlOri;

    /**
     * 页面对接原始地址
     */
    private String agentWebUrlOri;

    /**
     * 管理页面原始地址
     */
    private String agentAdminUrlOriList;

    /**
     * 创建类型: FROM_MANUALLY-手工创建, FROM_THIRD-从第三方创建, FROM_DEMO-从模板复制
     */
    private String createType;

    /**
     * 认证类型，session:共享session，oauth2:oauth2认证
     */
    private String authType;

    /**
     * 集成方式：默认为NONE，可选：PAGE（页面集成）、INTERFACE（接口集成）
     */
    private String integrationType;

    /**
     * 核心能力
     */
    private String ability;

    /**
     * 能力边界
     */
    private String constraints;

    /**
     * 示例问法
     */
    private String faqs;

    /**
     * 角色属性
     */
    private String roleAttributes;

    /**
     * 处理流程
     */
    private String processingFlow;

    /**
     * 性格维度
     */
    private String personalityDimensions;

    /**
     * 用词偏好
     */
    private String wordPreferences;

    /**
     * 句式和语气
     */
    private String sentenceAndTone;

    /**
     * 终端类型 APP:APP端，PC:PC端，ALL:全端
     */
    private String terminal;

    /**
     * 数字员工分类悬浮标签
     */
    private String tagName;

    /**
     * 关联技能标识列表，JSON字符串格式
     */
    @JsonDeserialize(using = StringOrArrayToJsonStringDeserializer.class)
    private String skills;

    /**
     * 数字员工核心能力存储，JSON字符串格式
     */
    private String coreCompetencies;

    /**
     * 打开超级助手 Y-开启 N-关闭
     */
    private String openSuperHelper;

    /**
     * 数据员工机器渠道配置
     */
    private String machineChannel;

    /**
     * 核心人设
     */
    private String corePersonaDefinition;

    /***
     * 高级设置
     */
    private String advancedSettings;

    /**
     * 数字员工同步到 MinIO 的标准 JSON 串镜像（含 relSkills / relTools 等运行期字段）。
     * 写入时机：在 doSyncOpenClawWorkSpace 生成 JSON 之后、推送 MinIO 之前。
     * 读取时机：findDetailsById 从此字段反序列化 relTools 等"不入库"的运行期入参，避免编辑回显丢失。
     */
    private String targetContent;
}
