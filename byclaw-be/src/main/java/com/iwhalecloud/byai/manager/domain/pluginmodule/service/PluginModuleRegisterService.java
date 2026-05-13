package com.iwhalecloud.byai.manager.domain.pluginmodule.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.domain.pluginmodule.enums.EmployeeTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceBizTypeEnum;
import com.iwhalecloud.byai.manager.domain.resource.enums.ResourceStatus;
import com.iwhalecloud.byai.manager.domain.resource.service.ResourceEventService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDigEmployeeService;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceService;
import com.iwhalecloud.byai.manager.dto.pluginmodule.RegisterRequest;
import com.iwhalecloud.byai.manager.dto.pluginmodule.RegisterResponse;
import com.iwhalecloud.byai.manager.entity.pluginmodule.FunctionMenuPermission;
import com.iwhalecloud.byai.manager.entity.resource.SsResExtDigEmployee;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.pluginmodule.FunctionMenuPermissionMapper;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.constants.resource.SystemCode;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.manager.application.service.auth.AuthApplicationService;
import org.apache.commons.lang3.StringUtils;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.BadSqlGrammarException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import java.time.LocalDateTime;
import java.util.Date;

@Service
public class PluginModuleRegisterService {

    private final Logger logger = LoggerFactory.getLogger(PluginModuleRegisterService.class);

    @Autowired
    private SequenceService SequenceService;

    @Autowired
    private SsResourceMapper ssResourceMapper;

    @Autowired
    private FunctionMenuPermissionMapper functionMenuPermissionMapper;

    @Autowired
    private SsResourceService ssResourceService;

    @Autowired
    private SsResExtDigEmployeeService ssResExtDigEmployeeService;

    @Autowired
    private AuthApplicationService authApplicationService;

    @Autowired
    private ResourceEventService resourceEventService;

    @Transactional
    public RegisterResponse registerSearchQuery(RegisterRequest request) {
        return doRegister(EmployeeTypeEnum.SEARCHQUERY, request);
    }

    @Transactional
    public RegisterResponse registerFunctionCloud(RegisterRequest request) {
        return doRegister(EmployeeTypeEnum.FUNCTION_CLOUD, request);
    }

    @Transactional
    public RegisterResponse registerDataCloud(RegisterRequest request) {
        return doRegister(EmployeeTypeEnum.DATA_CLOUD, request);
    }

    private RegisterResponse doRegister(EmployeeTypeEnum employeeType, RegisterRequest request) {
        SsResource existingResource = findEmployeeByCode(employeeType.getCode());

        if (existingResource != null) {
            return RegisterResponse.builder().success(true).message("数字员工已存在，无需重复注册")
                .employeeCode(existingResource.getResourceCode()).employeeId(existingResource.getResourceId())
                .isNew(false).build();
        }

        try {
            SsResource ssResource = createDigitalEmployee(employeeType, request);

            insertDefaultMenuPermission(ssResource.getResourceId(), employeeType);

            logger.info("数字员工注册成功: employeeCode={}, employeeId={}", ssResource.getResourceCode(),
                ssResource.getResourceId());

            return RegisterResponse.builder().success(true).message("数字员工注册成功")
                .employeeCode(ssResource.getResourceCode()).employeeId(ssResource.getResourceId()).isNew(true).build();
        }
        catch (DuplicateKeyException e) {
            existingResource = findEmployeeByCode(employeeType.getCode());
            return RegisterResponse.builder().success(true).message("数字员工已存在，无需重复注册")
                .employeeCode(existingResource.getResourceCode()).employeeId(existingResource.getResourceId())
                .isNew(false).build();
        }
    }

    private SsResource findEmployeeByCode(String employeeCode) {
        LambdaQueryWrapper<SsResource> queryWrapper = new LambdaQueryWrapper<>();
        queryWrapper.eq(SsResource::getResourceCode, employeeCode);
        return ssResourceMapper.selectOne(queryWrapper);
    }

    private SsResource createDigitalEmployee(EmployeeTypeEnum employeeType, RegisterRequest request) {
        SsResource ssResource = new SsResource();
        ssResource.setSystemCode(SystemCode.BYAI.getCode());
        ssResource.setResourceCode(employeeType.getCode());
        ssResource.setResourceName(employeeType.getDesc());
        ssResource.setResourceDesc(employeeType.getDesc() + "数字员工");
        ssResource.setResourceStatus(ResourceStatus.LIST.getNum());
        ssResource.setResourceId(SequenceService.nextVal());
        ssResource.setResourceBizType(ResourceBizTypeEnum.DIG_EMPLOYEE.name());
        ssResource.setCreateBy(CurrentUserHolder.getCurrentUserId());
        ssResource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResource.setCreateTime(new Date());
        ssResource.setResourceType("COMBIN");
        ssResource.setResourceDVerid(1L);
        ssResource.setResourceRVerid(0L);
        ssResource.setComAcctId(CurrentUserHolder.getEnterpriseId());
        ssResourceService.save(ssResource);

        SsResExtDigEmployee ssResExtDigEmployee = new SsResExtDigEmployee();
        ssResExtDigEmployee.setResourceId(ssResource.getResourceId());
        ssResExtDigEmployee.setAgentType("001");
        ssResExtDigEmployee.setAgentDevType("byai");
        ssResExtDigEmployee.setCreateType("FROM_THIRD");
        ssResExtDigEmployee.setHomeType("default");
        ssResExtDigEmployee.setAuthType("session");
        ssResExtDigEmployee.setIntegrationType("INTERFACE");

        String baseUrl = buildBaseUrl(request);

        switch (employeeType) {
            case SEARCHQUERY:
                ssResExtDigEmployee.setAgentSseHead(null);
                ssResExtDigEmployee.setAgentSseUrl(baseUrl + "/instant-search");
                ssResExtDigEmployee.setAgentWebUrl("");
                ssResExtDigEmployee.setAgentAdminUrlList("{\"urlList\":[]}");
                ssResExtDigEmployee.setPrologue(
                    "{\"modelInfo\":{\"model\":\"Qwen/Qwen3-235B-A22B\",\"modelId\":-1000,\"history\":6,\"temperature\":0.1,\"maxToken\":2000},\"fileUpload\":{\"enabled\":false,\"maxFileSize\":10,\"maxFileCount\":5,\"allowedFileTypes\":[]},\"descText\":\"您好！我是联网搜索，您的智能数字员工，随时为您提供精准的网络信息查询服务。\",\"openingQuestion\":[\"如何使用联网搜索功能\",\"联网搜索支持哪些网站\",\"搜索结果如何排序\"],\"modelId\":-1000}");
                ssResExtDigEmployee.setAgentSseUrlOri(baseUrl + "/instant-search");
                ssResExtDigEmployee.setAgentWebUrlOri("");
                ssResExtDigEmployee.setAgentAdminUrlOriList("{\"urlList\":[]}");
                ssResExtDigEmployee.setAgentHomeUrl(null);
                ssResExtDigEmployee.setAbility("");
                ssResExtDigEmployee.setConstraints("");
                ssResExtDigEmployee.setFaqs("");
                ssResExtDigEmployee.setRoleAttributes(
                    "角色定位：联网搜索智能体是一名专业的信息检索与分析专家，具备实时获取和整合网络信息的能力。身份特征为高效、精准、全面的信息获取者。\n专业背景：具备数据挖掘、信息检索及自然语言处理技术，拥有广泛的网络资源访问权限与智能分析能力。\n服务对象：适用于企业、研究人员、学生及任何需要快速获取网络信息的用户。\n应用场景：用于市场调研、学术研究、新闻追踪、竞争情报分析、问题解答等需要实时联网搜索的场景。");
                ssResExtDigEmployee.setProcessingFlow(
                    "**智能体工作流程描述：**\n\\\"联网搜索\\\"数字员工负责根据用户输入的查询内容，自动执行互联网信息检索任务，提供准确、及时的搜索结果摘要。\n**主要处理步骤：**\n1. **接收查询请求**：接收用户输入的搜索关键词或问题。\n2. **执行网络搜索**：调用搜索引擎API，获取相关网页信息。\n3. **信息筛选与摘要**：分析搜索结果，提取最相关的内容并生成简洁摘要。\n4. **结果反馈用户**：将整理后的信息以结构化方式返回给用户。\n**关键操作说明：**\n- 步骤1确保理解用户意图；\n- 步骤2依赖API获取实时数据；\n- 步骤3通过自然语言处理提取关键信息；\n- 步骤4优化信息呈现方式，提升用户体验。");
                ssResExtDigEmployee.setPersonalityDimensions(
                    "联网搜索智能体性格定义：\n性格特征：专业、高效、中立\n情感表达：简洁明确，无情绪波动，聚焦信息传递\n互动风格：指令导向，快速响应，提供精准信息与数据支持\n（150字内）");
                ssResExtDigEmployee.setWordPreferences(
                    "**智能体\\\"联网搜索\\\"用词偏好定义：**\n**专业术语与表达：** 常使用信息检索、关键词匹配、数据源、索引、爬取、API接口、网络协议、搜索引擎优化等技术相关术语。\n**语言风格：** 正式、简洁、逻辑清晰，注重信息准确性和效率。\n**句式与表达习惯：**\n- \\\"正在为您检索相关信息…\\\"\n- \\\"根据关键词'XXX'，找到以下结果…\\\"\n- \\\"数据来源包括但不限于…\\\"\n- \\\"建议使用更具体的关键词以获取精准结果。\\\"\n- 使用列表或分点方式呈现信息。");
                ssResExtDigEmployee.setSentenceAndTone(
                    "句式占比：陈述句70%（提供搜索结果），疑问句20%（确认需求），祈使句10%（引导操作）。语气以肯定式为主（明确信息），辅以建议式（推荐操作）。陈述句配合肯定式传递信息，疑问句用于协商式确认意图，祈使句用于指令式引导操作，提升交互效率与用户体验。");
                ssResExtDigEmployee.setTerminal("PC");
                ssResExtDigEmployee.setTagName(null);
                ssResExtDigEmployee.setCoreCompetencies(
                    "[{\"coreCompetency\":\"实时信息检索\",\"description\":\"通过互联网实时获取最新信息，帮助用户快速找到所需的资料、新闻或数据。\",\"acceptBoundary\":[\"搜索新闻和时事动态\",\"查找学术论文和技术报告\",\"获取特定主题的最新数据\",\"定位网站或网页内容\",\"查询百科知识和定义\"],\"rejectBoundary\":[\"不生成原创内容\",\"不提供付费数据库访问\",\"不处理非法或敏感信息请求\"],\"example\":[\"最近的科技新闻有哪些？\",\"查找关于气候变化的最新报告\",\"如何访问某个特定网站？\",\"解释量子计算的基本原理\"]},{\"coreCompetency\":\"多语言内容搜索\",\"description\":\"支持多种语言的信息检索，满足用户在不同语言环境下的搜索需求。\",\"acceptBoundary\":[\"英语、中文、西班牙语等主流语言搜索\",\"跨语言信息定位\",\"翻译并呈现非母语内容\",\"识别多语言关键词\",\"提供语言切换建议\"],\"rejectBoundary\":[\"不支持冷门或古代语言\",\"不处理模糊语言或方言\"],\"example\":[\"用西班牙语搜索旅游攻略\",\"查找日文的科技文章\",\"翻译英文论文摘要\",\"识别法语短语的意思\"]},{\"coreCompetency\":\"深度网页分析\",\"description\":\"对搜索结果进行深入分析，提取关键信息并整理成用户易理解的形式。\",\"acceptBoundary\":[\"提取网页核心内容\",\"总结长篇文章要点\",\"对比多个来源信息\",\"识别并过滤广告内容\",\"整理步骤式操作指南\"],\"rejectBoundary\":[\"不处理加密或受保护内容\",\"不分析动态加载的复杂网页\"],\"example\":[\"总结这篇博客的主要观点\",\"对比两款产品的优缺点\",\"从教程中提取操作步骤\",\"过滤广告后呈现纯净内容\"]}]");
                break;
            case FUNCTION_CLOUD:
                ssResExtDigEmployee.setRoleAttributes("角色定位：FunctionCloud智能体是一名专业的函数计算服务专家，具备函数编排和执行的能力。");
                ssResExtDigEmployee.setProcessingFlow("**智能体工作流程描述：**\nFunctionCloud数字员工负责根据用户需求，编排和执行函数计算任务。");
                ssResExtDigEmployee
                    .setPersonalityDimensions("性格特征：专业、严谨、高效\n情感表达：简洁明确，聚焦任务执行\n互动风格：指令导向，快速响应，提供精准的函数计算服务");
                ssResExtDigEmployee.setWordPreferences("专业术语与表达：常使用函数、计算、编排、执行等技术相关术语。\n语言风格：正式、简洁、逻辑清晰。");
                ssResExtDigEmployee.setSentenceAndTone("句式占比：陈述句80%（提供执行结果），疑问句10%（确认需求），祈使句10%（引导操作）。");
                ssResExtDigEmployee.setCoreCompetencies(
                    "[{\"coreCompetency\":\"函数计算\",\"description\":\"提供函数编排和执行服务，帮助用户快速完成计算任务。\"}]");
                break;
            case DATA_CLOUD:
                ssResExtDigEmployee.setRoleAttributes("角色定位：DataCloud智能体是一名专业的数据服务专家，具备数据查询、分析和处理的能力。");
                ssResExtDigEmployee.setProcessingFlow("**智能体工作流程描述：**\nDataCloud数字员工负责根据用户需求，提供数据查询、分析和处理服务。");
                ssResExtDigEmployee
                    .setPersonalityDimensions("性格特征：专业、严谨、高效\n情感表达：简洁明确，聚焦数据服务\n互动风格：指令导向，快速响应，提供精准的数据服务");
                ssResExtDigEmployee.setWordPreferences("专业术语与表达：常使用数据、查询、分析、处理等技术相关术语。\n语言风格：正式、简洁、逻辑清晰。");
                ssResExtDigEmployee.setSentenceAndTone("句式占比：陈述句80%（提供数据结果），疑问句10%（确认需求），祈使句10%（引导操作）。");
                ssResExtDigEmployee.setCoreCompetencies(
                    "[{\"coreCompetency\":\"数据服务\",\"description\":\"提供数据查询、分析和处理服务，帮助用户快速获取所需数据。\"}]");
                break;
            default:
                break;
        }
        ssResExtDigEmployeeService.save(ssResExtDigEmployee);

        authApplicationService.grantUsePrivToAll(ssResource);

        resourceEventService.sendResourceShelfEvent(ssResource);

        return ssResource;
    }

    private String buildBaseUrl(RegisterRequest request) {
        if (request == null || StringUtils.isBlank(request.getIp())) {
            return "";
        }
        StringBuilder baseUrl = new StringBuilder("http://");
        baseUrl.append(request.getIp());
        if (request.getPort() != null) {
            baseUrl.append(":").append(request.getPort());
        }
        return baseUrl.toString();
    }

    private void insertDefaultMenuPermission(Long employeeId, EmployeeTypeEnum employeeType) {
        FunctionMenuPermission permission = new FunctionMenuPermission();
        permission.setEmployeeId(employeeId);
        permission.setCreateTime(LocalDateTime.now());
        permission.setUpdateTime(LocalDateTime.now());

        switch (employeeType) {
            case SEARCHQUERY:
                permission.setMenuCode("/searchAndQuery");
                permission.setMenuName("搜问");
                break;
            case FUNCTION_CLOUD:
                permission.setMenuCode("/functionCloud");
                permission.setMenuName("FunctionCloud");
                break;
            case DATA_CLOUD:
                permission.setMenuCode("/dataCloud");
                permission.setMenuName("DataCloud");
                break;
            default:
                return;
        }

        try {
            functionMenuPermissionMapper.insert(permission);
        }
        catch (BadSqlGrammarException e) {
            logger.warn("function_menu_permission表不存在，跳过菜单权限插入: {}", e.getMessage());
        }
    }
}
