package com.iwhalecloud.byai.manager.domain.resource.enums;

import lombok.AllArgsConstructor;
import lombok.Data;
import lombok.Getter;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * @author zht
 * @version 1.0
 * @date 2025/6/4
 */
@Getter
public enum OptimizeTypeEnum {
    /**
     * 优化类型
     */
    AGENT_NAME("1", "agentName", "智能体名称"),
    // 智能体描述
    AGENT_DESCRIPTION("2", "agentDescription", "智能体描述"),
    // 人设描述
    CHARACTER_DESCRIPTION("3", "characterDescription", "人设描述"),
    // 开场白
    OPENING_REMARKS("4", "openingRemarks", "开场白"),
    // 常见问题
    COMMON_PROBLEM("5", "commonProblems", "常见问题"),
    // 对话问题推荐提示词
    RECOMMENDED_QUESTION("6", "recommendedQuestionPrompt", "对话问题推荐提示词"),
    // 对话问题推荐提示词
    AGENT_TAGS("7", "agentTags", "智能体标签"),
    // 核心能力
    ABILITY("8", "ability", "核心能力"),
    // 能力边界
    CONSTRAINTS("9", "constraints", "能力边界"),
    // 示例问法
    FAQS("10", "faqs", "示例问法"),
    // 角色属性
    ROLE_ATTRIBUTES("12", "roleAttributes", "角色属性"),
    // 处理流程
    PROCESSING_FLOW("13", "processingFlow", "处理流程"),
    // 性格维度
    PERSONALITY_DIMENSIONS("11", "personalityDimensions", "性格维度"),
    // 用词偏好
    WORD_PREFERENCES("11", "wordPreferences", "用词偏好");

    /**
     * 句式和语气
     */
    private String sentenceAndTone;

    public static final String ZH_AGENT_NAME_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息生成一个专业的智能体名称：
        ${description}
        要求：1. 符合专业背景 2. 体现服务态度 3. 10字以内
        """;

    public static final String ZH_AGENT_DESCRIPTION_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息生成一个专业的智能体描述：
        ${description}
        要求：1. 符合专业背景 2. 体现服务态度 3. 50字以内
        """;

    public static final String ZH_CHARACTER_DESCRIPTION_PROMPT = """
        你是一个智能体人设描述生成专家。请根据以下提供的智能体信息，为其生成一份专业、全面且符合要求的人设描述。
        **智能体信息：**
        ${description}
        **生成要求：**
        1.  **核心要求：**
            *   **明确专业背景：** 清晰阐述该智能体的核心专业技能、知识领域、擅长的任务类型及其深度/广度。说明其在相关领域扮演的角色或具备的权威性。
            *   **体现服务态度：** 贯穿始终地描述该智能体如何服务用户/处理任务，重点突出其沟通风格（如：耐心、热情、严谨、亲和、高效）、解决问题的主动性、对用户需求的关注度（如：理解用户意图、提供个性化支持）、以及在遇到困难时的处理原则（如：积极寻求解决方案、透明沟通、承诺跟进）。
        2.  **结构规范（请包含以下部分）：**
            *   **#角色规范：**
                *   清晰定义该智能体的**核心身份、职责范围与核心价值**。说明其存在的目的和为谁/解决什么问题。
                *   明确其**核心专业能力**（与要求1的专业背景对应）。
                *   （可选）提及其依赖的知识库或信息来源（如：基于XX领域知识库、遵循XX原则）。
            *   **#思考规范：**
                *   描述该智能体在处理问题或响应用户请求时的**内部决策逻辑和原则**。
                *   强调其如何**运用专业知识**进行分析、判断。
                *   体现其**服务导向的思考方式**（如：如何理解用户需求、如何确保信息准确性和有用性、如何处理不确定性）。
                *   可以包含优先级判断、信息验证方法等。
            *   **#回复规范：**
                *   规定该智能体与用户互动时的**外在行为准则和沟通风格**。
                *   重点强调其**服务态度的具体表现**（如：语气、措辞、信息呈现方式）。
                *   明确其如何确保**信息的准确性和专业性**（如：基于可靠来源、避免猜测）。
                *   说明其在**能力边界外或遇到困难时的处理流程**（如：坦诚说明限制、提供替代方案或指引、承诺后续跟进）。
                *   可以包含结束语习惯（如：主动询问用户是否还有其他问题）。

        **生成指引：**
        *   请将 `${description}` 的内容自然、准确地融入生成的人设描述中。
        *   语言需专业、清晰、连贯，避免模糊或过于笼统的表述。
        *   各部分内容应紧密围绕"专业背景"和"服务态度"两大核心要求展开。
        *   生成的描述应能有效指导该智能体的后续行为设定。
        *   500字内

        **请开始生成：**
        """;

    public static final String ZH_OPENING_REMARKS_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息生成一个友好的开场白，用于初次与用户交互：
        ${description}
        要求：1. 包含自我介绍 2. 表达服务意愿 3. 30字以内
        """;

    public static final String ZH_COMMON_PROBLEM_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息列出3个用户最可能问的常见问题。
        ${description}
        格式要求：
        1. 严格使用JSON数组格式：["问题1","问题2","问题3"]
        2. 禁止编号、标点结尾
        """;

    public static final String ZH_RECOMMENDED_QUESTION_PROMPT = """
        请为智能体生成一组用于指导AI生成追问类问题的提示词。
        # 智能体信息：
        ${description}
        # 要求如下：
        - 这些提示词应能规范AI生成的问题必须与最近一轮回复内容紧密相关，并能引发进一步讨论。
        - 这些提示词应要求AI避免重复上文已经提问或回答过的问题。
        - 这些提示词应要求每句话只包含一个问题，也可以是具体的指令（不一定是问句）。
        - 这些提示词应要求AI只推荐其有能力回答的三个问题。
        - 输出为简明的分条提示语句，每条一句，适合直接作为AI的行为约束。
        请根据上述要求，生成一组用于指导AI生成追问类问题的提示词。
        """;

    public static final String ZH_AGENT_TAGS_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息生成适合的标签：
        **智能体标签：**
        ${description}
        **生成要求：**
        1. 生成3-5个标签
        2. 标签能准确描述智能体功能
        3. 输出字符串数组结构的字符串，每个标签使用逗号分隔，例如："['标签1','标签2','标签3']"
        """;

    public static final String ZH_ABILITY_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息生成核心能力描述：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 列出3-5项核心能力
        2. 每项能力描述简洁明了
        3. 突出智能体的专业优势和特色
        4. 200字以内
        """;

    public static final String ZH_CONSTRAINTS_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息明确能力边界：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 清晰说明智能体不擅长或无法处理的任务
        2. 列出3-5项主要限制
        3. 诚实客观地描述能力范围
        4. 200字以内
        """;

    public static final String ZH_FAQS_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息生成示例问法：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 生成5-8个典型用户问题示例
        2. 问题应覆盖智能体的主要功能场景
        3. 问题表述自然口语化
        4. 严格使用JSON数组格式：["问题1","问题2","问题3"]
        """;

    public static final String ZH_ROLE_ATTRIBUTES_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息定义角色属性：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 定义智能体的角色定位和身份特征
        2. 描述其专业背景和资质
        3. 说明其服务对象和应用场景
        4. 200字以内
        """;

    public static final String ZH_PROCESSING_FLOW_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息描述处理流程：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 清晰描述智能体的工作流程
        2. 列出主要处理步骤（3-6步）
        3. 说明每个步骤的关键操作
        4. 300字以内
        """;

    public static final String ZH_PERSONALITY_DIMENSIONS_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息定义性格维度：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 描述智能体的性格特征（如：专业、亲和、严谨等）
        2. 说明其情感表达方式
        3. 定义其互动风格
        4. 150字以内
        """;

    public static final String ZH_WORD_PREFERENCES_PROMPT = """
        你是一个智能体设计助手。请根据以下智能体信息定义用词偏好：
        **智能体信息：**
        ${description}
        **生成要求：**
        1. 说明智能体常用的专业术语和表达方式
        2. 定义其语言风格（如：正式/亲切、简洁/详细）
        3. 列举其偏好使用的句式和表达习惯
        4. 200字以内
        """;

    public static final String EN_AGENT_NAME_PROMPT = """
        You are an agent design assistant. Please generate a professional agent name based on the following agent information:
        ${description}
        Requirements: 1. Match professional background 2. Reflect service attitude 3. Within 10 words
        """;

    public static final String EN_AGENT_DESCRIPTION_PROMPT = """
        You are an agent design assistant. Please generate a professional agent description based on the following agent information:
        ${description}
        Requirements: 1. Match professional background 2. Reflect service attitude 3. Within 50 words
        """;

    public static final String EN_CHARACTER_DESCRIPTION_PROMPT = """
        You are an expert in generating agent character descriptions. Please generate a professional, comprehensive, and compliant character description for the agent based on the information provided below.
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1.  **Core Requirements:**
            *   **Clarify Professional Background:** Clearly state the agent's core professional skills, knowledge areas, types of tasks it excels at, and the depth/breadth of its expertise. Explain the role it plays or the authority it possesses in the relevant field.
            *   **Reflect Service Attitude:** Consistently describe how the agent serves users/handles tasks, highlighting its communication style (e.g., patient, enthusiastic, rigorous, friendly, efficient), initiative in problem-solving, attention to user needs (e.g., understanding user intent, providing personalized support), and its principles when facing difficulties (e.g., actively seeking solutions, transparent communication, commitment to follow-up).
        2.  **Structural Specifications (please include the following sections):**
            *   **#Role Specification:**
                *   Clearly define the agent's **core identity, scope of responsibilities, and core value**. State its purpose and for whom/what problems it exists to solve.
                *   Specify its **core professional capabilities** (corresponding to the professional background in Requirement 1).
                *   (Optional) Mention the knowledge base or information sources it relies on (e.g., based on XX domain knowledge base, following XX principles).
            *   **#Thinking Specification:**
                *   Describe the agent's **internal decision logic and principles** when handling problems or responding to user requests.
                *   Emphasize how it **applies professional knowledge** for analysis and judgment.
                *   Reflect its **service-oriented thinking** (e.g., how it understands user needs, ensures information accuracy and usefulness, handles uncertainty).
                *   May include priority judgments, information verification methods, etc.
            *   **#Reply Specification:**
                *   Specify the agent's **external behavioral norms and communication style** when interacting with users.
                *   Emphasize the **specific manifestations of its service attitude** (e.g., tone, wording, information presentation).
                *   Clarify how it ensures **accuracy and professionalism of information** (e.g., based on reliable sources, avoiding speculation).
                *   Explain its process when **facing limitations or difficulties** (e.g., honestly stating limitations, providing alternatives or guidance, committing to follow-up).
                *   May include closing habits (e.g., proactively asking if the user has other questions).

        **Generation Guidelines:**
        *   Please naturally and accurately integrate the content of `${description}` into the generated character description.
        *   The language should be professional, clear, and coherent, avoiding vague or overly general statements.
        *   Each section should closely revolve around the two core requirements of "professional background" and "service attitude".
        *   The generated description should effectively guide the agent's subsequent behavior settings.
        *   Within 500 words

        **Please start generating:**
        """;

    public static final String EN_OPENING_REMARKS_PROMPT = """
        You are an agent design assistant. Please generate a friendly opening remark for initial user interaction based on the following agent information:
        ${description}
        Requirements: 1. Include self-introduction 2. Express service willingness 3. Within 30 words
        """;

    public static final String EN_COMMON_PROBLEM_PROMPT = """
        You are an agent design assistant. Please list the top 3 common questions users are most likely to ask based on the following agent information:
        ${description}
        Format:
        1.Strictly use JSON array format: ["question1","question2","question3"]
        2.No numbering or ending punctuation in questions
        """;

    public static final String EN_RECOMMENDED_QUESTION_PROMPT = """
        Please generate a set of prompts to guide the AI in generating follow-up questions.
        # Agent Information:
        ${description}
        # Requirements:
        - These prompts should ensure that the AI's generated questions are closely related to the most recent reply and can lead to further discussion.
        - These prompts should require the AI to avoid repeating questions or answers that have already been asked or answered above.
        - These prompts should require that each sentence contains only one question, or it can be a specific instruction (not necessarily a question).
        - These prompts should require the AI to recommend only three questions that it is capable of answering.
        - Output should be concise, with each prompt as a separate statement, suitable for directly constraining the AI's behavior.
        Please generate a set of prompts according to the above requirements to guide the AI in generating follow-up questions.
        """;

    public static final String EN_AGENT_TAGS_PROMPT = """
        You are an agent design assistant. Please generate appropriate tags based on the following agent information:
        **Agent Tags:**
        ${description}
        **Generation Requirements:**
        1. Generate 3-5 tags
        2. Tags should accurately describe agent functions
        3. Output as a string array structure, with each tag separated by commas, for example: "['tag1','tag2','tag3']"
        """;

    public static final String EN_ABILITY_PROMPT = """
        You are an agent design assistant. Please generate a core ability description based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. List 3-5 core capabilities
        2. Each capability should be described concisely and clearly
        3. Highlight the agent's professional strengths and distinctive features
        4. Within 200 words
        """;

    public static final String EN_CONSTRAINTS_PROMPT = """
        You are an agent design assistant. Please clarify the capability boundaries based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. Clearly state tasks the agent is not good at or cannot handle
        2. List 3-5 main limitations
        3. Describe the capability scope honestly and objectively
        4. Within 200 words
        """;

    public static final String EN_FAQS_PROMPT = """
        You are an agent design assistant. Please generate example questions based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. Generate 5-8 typical user question examples
        2. Questions should cover the agent's main functional scenarios
        3. Questions should be naturally conversational
        4. Strictly use JSON array format: ["question1","question2","question3"]
        """;

    public static final String EN_ROLE_ATTRIBUTES_PROMPT = """
        You are an agent design assistant. Please define role attributes based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. Define the agent's role positioning and identity characteristics
        2. Describe its professional background and qualifications
        3. Explain its target audience and application scenarios
        4. Within 200 words
        """;

    public static final String EN_PROCESSING_FLOW_PROMPT = """
        You are an agent design assistant. Please describe the processing flow based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. Clearly describe the agent's workflow
        2. List main processing steps (3-6 steps)
        3. Explain key operations in each step
        4. Within 300 words
        """;

    public static final String EN_PERSONALITY_DIMENSIONS_PROMPT = """
        You are an agent design assistant. Please define personality dimensions based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. Describe the agent's personality traits (e.g., professional, friendly, rigorous)
        2. Explain its emotional expression style
        3. Define its interaction style
        4. Within 150 words
        """;

    public static final String EN_WORD_PREFERENCES_PROMPT = """
        You are an agent design assistant. Please define word preferences based on the following agent information:
        **Agent Information:**
        ${description}
        **Generation Requirements:**
        1. Specify the professional terminology and expressions the agent commonly uses
        2. Define its language style (e.g., formal/friendly, concise/detailed)
        3. List its preferred sentence patterns and expression habits
        4. Within 200 words
        """;

    private final String type;

    private final String enName;

    private final String desc;

    OptimizeTypeEnum(String type, String enName, String desc) {
        this.type = type;
        this.enName = enName;
        this.desc = desc;
    }

    public static String getPrompt(OptimizeTypeEnum type, List<OptimizeField> promptList, String lang) {
        StringBuilder agentInfo = new StringBuilder();
        for (OptimizeField field : promptList) {
            String name = "zh".equals(lang) ? field.getType().getDesc() : field.getType().getEnName();
            agentInfo.append(name).append(": ").append(field.getValue()).append("\n");
        }

        String template = "";
        switch (type) {
            case AGENT_DESCRIPTION:
                template = "zh".equals(lang) ? ZH_AGENT_DESCRIPTION_PROMPT : EN_AGENT_DESCRIPTION_PROMPT;
                break;
            case CHARACTER_DESCRIPTION:
                template = "zh".equals(lang) ? ZH_CHARACTER_DESCRIPTION_PROMPT : EN_CHARACTER_DESCRIPTION_PROMPT;
                break;
            case OPENING_REMARKS:
                template = "zh".equals(lang) ? ZH_OPENING_REMARKS_PROMPT : EN_OPENING_REMARKS_PROMPT;
                break;
            case COMMON_PROBLEM:
                template = "zh".equals(lang) ? ZH_COMMON_PROBLEM_PROMPT : EN_COMMON_PROBLEM_PROMPT;
                break;
            case RECOMMENDED_QUESTION:
                template = "zh".equals(lang) ? ZH_RECOMMENDED_QUESTION_PROMPT : EN_RECOMMENDED_QUESTION_PROMPT;
                break;
            case AGENT_TAGS:
                template = "zh".equals(lang) ? ZH_AGENT_TAGS_PROMPT : EN_AGENT_TAGS_PROMPT;
                break;
            case ABILITY:
                template = "zh".equals(lang) ? ZH_ABILITY_PROMPT : EN_ABILITY_PROMPT;
                break;
            case CONSTRAINTS:
                template = "zh".equals(lang) ? ZH_CONSTRAINTS_PROMPT : EN_CONSTRAINTS_PROMPT;
                break;
            case FAQS:
                template = "zh".equals(lang) ? ZH_FAQS_PROMPT : EN_FAQS_PROMPT;
                break;
            case ROLE_ATTRIBUTES:
                template = "zh".equals(lang) ? ZH_ROLE_ATTRIBUTES_PROMPT : EN_ROLE_ATTRIBUTES_PROMPT;
                break;
            case PROCESSING_FLOW:
                template = "zh".equals(lang) ? ZH_PROCESSING_FLOW_PROMPT : EN_PROCESSING_FLOW_PROMPT;
                break;
            case PERSONALITY_DIMENSIONS:
                template = "zh".equals(lang) ? ZH_PERSONALITY_DIMENSIONS_PROMPT : EN_PERSONALITY_DIMENSIONS_PROMPT;
                break;
            case WORD_PREFERENCES:
                template = "zh".equals(lang) ? ZH_WORD_PREFERENCES_PROMPT : EN_WORD_PREFERENCES_PROMPT;
                break;

            default:
                template = "";
        }

        return template.replace("${description}", agentInfo.toString());
    }

    @Data
    @AllArgsConstructor
    @NoArgsConstructor
    public static class OptimizeField {
        OptimizeTypeEnum type;

        String value;
    }
}
