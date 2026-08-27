package com.iwhalecloud.byai.manager.interfaces.controller.devloop;

import com.iwhalecloud.byai.common.feign.request.datacloud.Params;
import com.iwhalecloud.byai.common.feign.request.datacloud.QueryByKnowledgeReq;
import com.iwhalecloud.byai.common.feign.response.datacloud.InvokeActionResp;
import com.iwhalecloud.byai.common.feign.response.datacloud.QueryByKnowledgeResp;
import com.iwhalecloud.byai.common.util.StringUtil;
import com.iwhalecloud.byai.manager.application.service.devloop.DevloopApplicationService;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.MapParamUtil;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskListQueryDto;
import com.iwhalecloud.byai.manager.dto.devloop.ListObjectFilePkIdDto;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitDTO;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementPresplitResultDto;
import com.iwhalecloud.byai.manager.dto.devloop.RequirementSplitDTO;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskStateDto;
import com.iwhalecloud.byai.manager.dto.devloop.DevloopTaskViewDto;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDeleteDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ManualRequirementUpdateDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationRequirementDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationAccountDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationRequirementStartDTO;
import com.iwhalecloud.byai.manager.dto.devloop.OperationTaskDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ListObjectFileDto;
import com.iwhalecloud.byai.manager.dto.devloop.ListProjectTaskStatusDto;
import com.iwhalecloud.byai.manager.dto.devloop.ObjectFileGroupDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ObjectFileSaveDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationEnvDTO;
import com.iwhalecloud.byai.manager.dto.devloop.IntegrationSuiteDTO;
import com.iwhalecloud.byai.manager.dto.devloop.DefaultAgentDTO;
import com.iwhalecloud.byai.manager.dto.devloop.TesterConfigDTO;
import com.iwhalecloud.byai.manager.dto.devloop.UpdateTaskStatusDto;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectObjectFile;
import com.iwhalecloud.byai.manager.entity.devloop.ProjectTaskStatus;
import com.iwhalecloud.byai.manager.entity.devloop.OperationTaskTemplate;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import jakarta.servlet.http.HttpServletRequest;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.*;
import java.util.Collection;
import java.util.List;
import java.util.Map;

/**
 * 研发闭环控制器 提供需求收集源管理、扫描触发、扫描日志、GitHub PAT、钉钉群搜索等接口
 */
@RestController
@RequestMapping("/devloop")
public class DevloopController {

    @Autowired
    private DevloopApplicationService applicationService;

    /**
     * 创建扫描源
     *
     * @param dto 扫描源信息（projectId、sourceName、sourceType、config必填）
     * @return 新建源ID
     */
    @PostMapping("/source/create")
    public ResponseUtil<Map<String, Object>> createScanSource(@RequestBody ScanSourceDTO dto) {
        return applicationService.createScanSource(dto);
    }

    /**
     * 修改扫描源配置
     *
     * @param dto 包含 sourceId（必填）、sourceName、config、cronExpr（可选）
     */
    @PostMapping("/source/update")
    public ResponseUtil<Void> updateScanSource(@RequestBody ScanSourceDTO dto) {
        return applicationService.updateScanSource(dto);
    }

    /**
     * 删除扫描源
     *
     * @param params 包含 sourceId
     */
    @PostMapping("/source/delete")
    public ResponseUtil<Void> deleteScanSource(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        return applicationService.deleteScanSource(sourceId);
    }

    /**
     * 查询项目下的扫描源列表
     *
     * @param params 包含 projectId、keyword、pageNum、pageSize
     * @return 扫描源分页列表（含启用状态、最近扫描时间等）
     */
    @PostMapping("/source/list")
    public ResponseUtil<PageInfo<Map<String, Object>>> listScanSources(@RequestBody Map<String, Object> params) {
        // 单参 getLongValue 缺省返回 0L，会被下游当成「项目 0」过滤掉全部数据；
        // 自动化页不传 projectId 表示跨项目查询，必须显式把缺省值给成 null。
        Long projectId = MapParamUtil.getLongValue(params, "projectId", null);
        String keyword = MapParamUtil.getStringValue(params, "keyword");
        int pageNum = Math.max(1, MapParamUtil.getIntValue(params, "pageNum", 1));
        int pageSize = Math.max(1, MapParamUtil.getIntValue(params, "pageSize", 30));
        // 自动化页传 onlyMine=true 只看自己建的；项目渠道页不传，保持原有全项目可见口径。
        boolean onlyMine = Boolean.parseBoolean(String.valueOf(params.get("onlyMine")));
        return applicationService.listScanSources(projectId, keyword, onlyMine, pageNum, pageSize);
    }

    /**
     * 启用/停用扫描源
     *
     * @param params 包含 sourceId、enabled（"1"启用/"0"停用）
     */
    @PostMapping("/source/toggle")
    public ResponseUtil<Void> toggleScanSource(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        String enabled = params.get("enabled").toString();
        return applicationService.toggleScanSource(sourceId, enabled);
    }

    /**
     * 手动触发一次扫描
     *
     * @param params 包含 sourceId
     * @return 本次扫描新建的条目数
     */
    @PostMapping("/source/scan")
    public ResponseUtil<Map<String, Object>> triggerScan(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        return applicationService.triggerScan(sourceId);
    }

    /**
     * 查询扫描日志列表
     *
     * @param params 包含 sourceId、limit（可选，默认20）
     * @return 按时间倒序的扫描日志
     */
    @PostMapping("/log/list")
    public ResponseUtil<List<Map<String, Object>>> listScanLogs(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        int limit = params.containsKey("limit") ? Integer.parseInt(params.get("limit").toString()) : 20;
        return applicationService.listScanLogs(sourceId, limit);
    }

    /**
     * 分页查询当前用户自动化的运行记录
     *
     * @param params 包含 status、keyword（可选）、pageNum、pageSize
     * @return 按扫描时间倒序的运行记录分页
     */
    @PostMapping("/automation/run/list")
    public ResponseUtil<PageInfo<Map<String, Object>>> listMyAutomationRuns(@RequestBody Map<String, Object> params) {
        String status = MapParamUtil.getStringValue(params, "status");
        String keyword = MapParamUtil.getStringValue(params, "keyword");
        int pageNum = Math.max(1, MapParamUtil.getIntValue(params, "pageNum", 1));
        int pageSize = Math.max(1, MapParamUtil.getIntValue(params, "pageSize", 20));
        return applicationService.listMyAutomationRuns(status, keyword, pageNum, pageSize);
    }

    /**
     * 查询某次扫描的详细条目
     *
     * @param params 包含 logId
     * @return 扫描发现的每条需求/Issue信息
     */
    @PostMapping("/log/items")
    public ResponseUtil<List<Map<String, Object>>> listScanRequireItems(@RequestBody Map<String, Object> params) {
        Long logId = Long.valueOf(params.get("logId").toString());
        return applicationService.listScanRequireItems(logId);
    }

    /**
     * 按扫描源查询已收集的需求列表(action=created)
     *
     * @param params 包含 sourceId
     * @return 该源下所有需求条目(含评分)，按时间倒序
     */
    @PostMapping("/source/requirements")
    public ResponseUtil<List<Map<String, Object>>> listRequirementsBySource(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        return applicationService.listRequirementsBySource(sourceId);
    }

    // ========== 集成测试环境 ==========

    /**
     * 创建集成测试环境
     *
     * @param dto 环境信息（projectId、envName 必填；stages/testAccounts 为JSON字符串）
     * @return 新建环境ID
     */
    @PostMapping("/integration/env/create")
    public ResponseUtil<Map<String, Object>> createIntegrationEnv(@RequestBody IntegrationEnvDTO dto) {
        return applicationService.createIntegrationEnv(dto);
    }

    /**
     * 修改集成测试环境
     *
     * @param dto 包含 envId（必填）及待更新字段
     */
    @PostMapping("/integration/env/update")
    public ResponseUtil<Void> updateIntegrationEnv(@RequestBody IntegrationEnvDTO dto) {
        return applicationService.updateIntegrationEnv(dto);
    }

    /**
     * 删除集成测试环境
     *
     * @param params 包含 envId
     */
    @PostMapping("/integration/env/delete")
    public ResponseUtil<Void> deleteIntegrationEnv(@RequestBody Map<String, Object> params) {
        Long envId = Long.valueOf(params.get("envId").toString());
        return applicationService.deleteIntegrationEnv(envId);
    }

    /**
     * 查询项目下的集成测试环境列表
     *
     * @param params 包含 projectId
     */
    @PostMapping("/integration/env/list")
    public ResponseUtil<List<Map<String, Object>>> listIntegrationEnvs(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.listIntegrationEnvs(projectId);
    }

    /**
     * 新建端到端测试用例集
     *
     * @param dto 用例集信息（projectId、suiteName 必填）
     * @return 新建用例集ID
     */
    @PostMapping("/integration/suite/create")
    public ResponseUtil<Map<String, Object>> createIntegrationSuite(@RequestBody IntegrationSuiteDTO dto) {
        return applicationService.createIntegrationSuite(dto);
    }

    /**
     * 修改端到端测试用例集
     *
     * @param dto 包含 suiteId（必填）及待更新字段
     */
    @PostMapping("/integration/suite/update")
    public ResponseUtil<Void> updateIntegrationSuite(@RequestBody IntegrationSuiteDTO dto) {
        return applicationService.updateIntegrationSuite(dto);
    }

    /**
     * 删除端到端测试用例集
     *
     * @param params 包含 suiteId
     */
    @PostMapping("/integration/suite/delete")
    public ResponseUtil<Void> deleteIntegrationSuite(@RequestBody Map<String, Object> params) {
        Long suiteId = Long.valueOf(params.get("suiteId").toString());
        return applicationService.deleteIntegrationSuite(suiteId);
    }

    /**
     * 启用/停用端到端测试用例集
     *
     * @param params 包含 suiteId、enabled('0'/'1')
     */
    @PostMapping("/integration/suite/toggle")
    public ResponseUtil<Void> toggleIntegrationSuite(@RequestBody Map<String, Object> params) {
        Long suiteId = Long.valueOf(params.get("suiteId").toString());
        String enabled = params.get("enabled").toString();
        return applicationService.toggleIntegrationSuite(suiteId, enabled);
    }

    /**
     * 查询项目下的端到端测试用例集列表
     *
     * @param params 包含 projectId
     */
    @PostMapping("/integration/suite/list")
    public ResponseUtil<List<Map<String, Object>>> listIntegrationSuites(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.listIntegrationSuites(projectId);
    }

    /**
     * 查询默认助理原始配置(某作用域)。
     *
     * @param params 可含 projectId:缺省/0=全局默认行,>0=该项目覆盖行
     */
    @PostMapping("/default-agent/get")
    public ResponseUtil<Map<String, Object>> getDefaultAgent(@RequestBody Map<String, Object> params) {
        return applicationService.getDefaultAgent(parseProjectId(params));
    }

    /**
     * 解析项目各角色生效的默认助理(项目覆盖合并到全局默认之上)。
     *
     * @param params 可含 projectId;缺省则仅返回全局默认
     */
    @PostMapping("/default-agent/resolve")
    public ResponseUtil<Map<String, Object>> resolveDefaultAgent(@RequestBody Map<String, Object> params) {
        return applicationService.resolveDefaultAgent(parseProjectId(params));
    }

    /**
     * 保存默认助理配置(每作用域唯一,upsert)。
     *
     * @param dto projectId 缺省/0=全局默认,>0=项目覆盖;各角色 agentId 为空表示不指定
     */
    @PostMapping("/default-agent/save")
    public ResponseUtil<Void> saveDefaultAgent(@RequestBody DefaultAgentDTO dto) {
        return applicationService.saveDefaultAgent(dto);
    }

    /**
     * 查询项目的独立测试数字员工配置(定时节流/就绪准入/失败打回);无记录回填出厂默认。
     *
     * @param params 包含 projectId
     */
    @PostMapping("/tester-config/get")
    public ResponseUtil<Map<String, Object>> getTesterConfig(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.getTesterConfig(projectId);
    }

    /**
     * 保存项目的独立测试数字员工配置(每项目唯一,upsert)。
     *
     * @param dto 嵌套配置(enabled/schedule/admission/kickback);projectId 必填
     */
    @PostMapping("/tester-config/save")
    public ResponseUtil<Void> saveTesterConfig(@RequestBody TesterConfigDTO dto) {
        return applicationService.saveTesterConfig(dto);
    }

    /**
     * 手动触发一次项目批量集成:对项目下所有启用用例集 × 指定环境各起一次真实执行,秒回 runId 列表。
     *
     * @param params 包含 projectId、envId
     */
    @PostMapping("/tester-config/run")
    public ResponseUtil<Map<String, Object>> runTesterBatch(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        Long envId = Long.valueOf(params.get("envId").toString());
        return applicationService.runTesterBatch(projectId, envId);
    }

    /**
     * 需求级集成聚合看板:项目下已拆解需求按「需求→多仓库任务」组装,含就绪状态、最近执行结果与打回记录。
     *
     * @param params 包含 projectId
     */
    @PostMapping("/integration/requirements")
    public ResponseUtil<List<Map<String, Object>>> listRequirementIntegrations(
        @RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        return applicationService.listRequirementIntegrations(projectId);
    }

    /** projectId 可缺省(全局默认),缺省或空串归一为 null 交由下游按全局处理。 */
    private Long parseProjectId(Map<String, Object> params) {
        Object raw = params == null ? null : params.get("projectId");
        if (raw == null || raw.toString().isEmpty()) {
            return null;
        }
        return Long.valueOf(raw.toString());
    }

    /**
     * 触发一次「执行测试」:连上集成测试环境跑 stages + 套件命令,秒回 runId,后台异步执行。
     *
     * @param params 包含 suiteId、envId
     */
    @PostMapping("/integration/run/start")
    public ResponseUtil<Map<String, Object>> startIntegrationRun(@RequestBody Map<String, Object> params) {
        Long suiteId = Long.valueOf(params.get("suiteId").toString());
        Long envId = Long.valueOf(params.get("envId").toString());
        // executorMode 可选:前端弹框按次指定 backend/tester,缺省或非法值由执行器回落全局配置。
        Object mode = params.get("executorMode");
        return applicationService.startIntegrationRun(suiteId, envId, mode == null ? null : mode.toString());
    }

    /**
     * 查询一次执行的完整结果(含步骤进度),供前端轮询。
     *
     * @param params 包含 runId
     */
    @PostMapping("/integration/run/get")
    public ResponseUtil<Map<String, Object>> getIntegrationRun(@RequestBody Map<String, Object> params) {
        Long runId = Long.valueOf(params.get("runId").toString());
        return applicationService.getIntegrationRun(runId);
    }

    /**
     * 读取一次执行的测试报告原文,供前端在线预览/下载。原文不落库,每次查看按需去环境机读取。
     *
     * @param params 包含 runId
     */
    @PostMapping("/integration/run/report")
    public ResponseUtil<Map<String, Object>> getIntegrationRunReport(@RequestBody Map<String, Object> params) {
        Long runId = Long.valueOf(params.get("runId").toString());
        return applicationService.getIntegrationRunReport(runId);
    }

    /**
     * 查询某套件的历史执行列表。
     *
     * @param params 包含 suiteId
     */
    @PostMapping("/integration/run/list")
    public ResponseUtil<List<Map<String, Object>>> listIntegrationRuns(@RequestBody Map<String, Object> params) {
        Long suiteId = Long.valueOf(params.get("suiteId").toString());
        return applicationService.listIntegrationRuns(suiteId);
    }

    /**
     * 按环境查历史执行列表(时间倒序)。
     *
     * @param params 包含 envId
     */
    @PostMapping("/integration/run/listByEnv")
    public ResponseUtil<List<Map<String, Object>>> listIntegrationRunsByEnv(@RequestBody Map<String, Object> params) {
        Long envId = Long.valueOf(params.get("envId").toString());
        return applicationService.listIntegrationRunsByEnv(envId);
    }

    /** 按项目一次查全部需求(时间倒序)，供需求列表直查，替代前端逐源循环 */
    @PostMapping("/project/requirements")
    public ResponseUtil<List<Map<String, Object>>> listRequirementsByProject(@RequestBody Map<String, Object> params) {
        Long projectId = Long.valueOf(params.get("projectId").toString());
        String title = params.get("title") != null ? params.get("title").toString() : null;
        // 兼容已发布前端的 keyword 入参，但需求查询始终只按名称执行。
        if (title == null && params.get("keyword") != null) {
            title = params.get("keyword").toString();
        }
        return applicationService.listRequirementsByProject(projectId, title);
    }

    /**
     * 新建不经渠道扫描的手工需求。仍写入扫描日志链路，需求列表和任务派生无需维护独立数据流。
     *
     * @param dto 语言无关的手工需求字段
     * @return 按当前请求语言组装的已创建需求
     */
    @PostMapping("/requirement/create")
    public ResponseUtil<Map<String, Object>> createManualRequirement(@RequestBody ManualRequirementDTO dto) {
        return applicationService.createManualRequirement(dto);
    }

    /**
     * 修改尚未启动的手工需求。扫描渠道产生的需求及已启动需求均不能通过该接口修改。
     *
     * @param dto 手工需求的可编辑字段及需求条目 ID
     * @return 按当前请求语言组装的已修改需求
     */
    @PostMapping("/requirement/update")
    public ResponseUtil<Map<String, Object>> updateManualRequirement(@RequestBody ManualRequirementUpdateDTO dto) {
        return applicationService.updateManualRequirement(dto);
    }

    /**
     * 删除尚未启动的手工需求。服务端仅允许所属项目创建者执行，避免绕过前端权限控制。
     *
     * @param dto 待删除的需求条目 ID
     */
    @PostMapping("/requirement/delete")
    public ResponseUtil<Void> deleteManualRequirement(@RequestBody ManualRequirementDeleteDTO dto) {
        return applicationService.deleteManualRequirement(dto);
    }

    /**
     * 保存GitHub Personal Access Token
     *
     * @param params 包含 pat（明文，后端SM4加密存储）
     */
    @PostMapping("/pat/github")
    public ResponseUtil<Void> saveGitHubPat(@RequestBody Map<String, Object> params) {
        String pat = params.get("pat") != null ? params.get("pat").toString() : "";
        if (pat.isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.pat.required"));
        }
        return applicationService.saveGitHubPat(pat);
    }

    /**
     * 检查当前用户是否已保存GitHub PAT
     *
     * @return hasPat布尔值，已存储时额外返回last4
     */
    @PostMapping("/pat/github/check")
    public ResponseUtil<Map<String, Object>> checkGitHubPat() {
        return applicationService.checkGitHubPat();
    }

    /**
     * 搜索钉钉群（通过DWS CLI）
     *
     * @param params 包含 query（群名关键词，至少2个字符）
     * @return 匹配的群列表（openConversationId + name）
     */
    @PostMapping("/dingtalk/groups/search")
    public ResponseUtil<List<Map<String, Object>>> searchDingtalkGroups(@RequestBody Map<String, Object> params) {
        String query = params.get("query") != null ? params.get("query").toString() : "";
        if (query.isEmpty()) {
            return ResponseUtil.failRes(I18nUtil.get("devloop.dingtalk.search.keyword.required"));
        }
        return applicationService.searchDingtalkGroups(query);
    }

    // ========== 研发任务 ==========

    /** 从需求创建任务 */
    @PostMapping("/task/create")
    public ResponseUtil<Map<String, Object>> createTask(@RequestBody Map<String, Object> params) {
        return applicationService.createTask(params);
    }

    /** 需求 AI 预拆:模型按仓库清单产出子任务草稿,只读不落库,前端编辑后再调 /task/split */
    @PostMapping("/task/presplit")
    public ResponseUtil<RequirementPresplitResultDto> presplitRequirement(@RequestBody RequirementPresplitDTO dto) {
        return applicationService.getRequirementPresplit(dto);
    }

    /** 需求拆分为多仓库子任务(各自 repo/分支/承接员工,子任务间 DAG 依赖) */
    @PostMapping("/task/split")
    public ResponseUtil<Map<String, Object>> splitTask(@RequestBody RequirementSplitDTO dto) {
        return applicationService.splitTask(dto);
    }

    /** 需求交给需求数字员工在聊天里聊完成(与 /task/split 二选一,共用需求 sessionId 闸门) */
    @PostMapping("/requirement/clarify")
    public ResponseUtil<Map<String, Object>> startRequirementClarify(@RequestBody Map<String, Object> params) {
        Object projectId = params.get("projectId");
        Object sourceItemId = params.get("sourceItemId");
        return applicationService.startRequirementClarify(
            projectId == null ? null : Long.valueOf(projectId.toString()),
            sourceItemId == null ? null : Long.valueOf(sourceItemId.toString()));
    }

    /** 查询项目任务列表 */
    @PostMapping("/task/list")
    public ResponseUtil<PageInfo<DevloopTaskViewDto>> listTasks(@RequestBody DevloopTaskListQueryDto query) {
        return applicationService.listTasks(query);
    }

    /** 获取任务(会话)详情 */
    @PostMapping("/task/detail")
    public ResponseUtil<DevloopTaskViewDto> getTaskDetail(@RequestBody Map<String, Object> params) {
        Long sessionId = Long.valueOf(
            params.get("sessionId") != null ? params.get("sessionId").toString() : params.get("taskId").toString());
        return applicationService.getTaskDetail(sessionId);
    }

    /** 获取任务环节进度：直接读取 self-developed-rules v2 会话状态投影 */
    @PostMapping("/task/phases")
    public ResponseUtil<DevloopTaskStateDto> getTaskPhases(@RequestBody Map<String, Object> params) {
        Long sessionId = Long.valueOf(
            params.get("sessionId") != null ? params.get("sessionId").toString() : params.get("taskId").toString());
        return applicationService.getTaskPhases(sessionId);
    }

    /** 获取任务代码变更：目标分支相对仓库默认分支的文件变更列表(远程分支口径) */
    @PostMapping("/task/changes")
    public ResponseUtil<Map<String, Object>> getTaskChanges(@RequestBody Map<String, Object> params) {
        Long sessionId = Long.valueOf(
            params.get("sessionId") != null ? params.get("sessionId").toString() : params.get("taskId").toString());
        Long repoId = params.get("repoId") != null ? Long.valueOf(params.get("repoId").toString()) : null;
        return applicationService.getTaskChanges(sessionId, repoId);
    }

    /** 获取指定代码仓库中单个文件的本地 diff(unified 文本),供前端 modal 逐行渲染变更内容 */
    @PostMapping("/task/file-diff")
    public ResponseUtil<Map<String, Object>> getTaskFileDiff(@RequestBody Map<String, Object> params) {
        Long sessionId = Long.valueOf(
            params.get("sessionId") != null ? params.get("sessionId").toString() : params.get("taskId").toString());
        Long repoId = params.get("repoId") != null ? Long.valueOf(params.get("repoId").toString()) : null;
        String filePath = params.get("filePath") != null ? params.get("filePath").toString() : "";
        return applicationService.getTaskFileDiff(sessionId, repoId, filePath);
    }

    // ========== DWS 钉钉授权 ==========

    /** 启动设备授权流程（返回userCode和verificationUrl，前端打开URL让用户授权） */
    @PostMapping("/dws/startDeviceAuth")
    public ResponseUtil<Map<String, Object>> startDwsDeviceAuth() {
        return applicationService.startDwsDeviceAuth();
    }

    /** 检查DWS授权状态（前端轮询，直到tokenValid=true）：新建源时当前用户给自己授权用 */
    @PostMapping("/dws/authStatus")
    public ResponseUtil<Map<String, Object>> checkDwsAuthStatus() {
        return applicationService.checkDwsAuthStatus();
    }

    /** 按扫描源查授权状态：查该源创建者的授权,返回 canAuthorize/creatorName,供列表逐源展示 */
    @PostMapping("/dws/authStatus/bySource")
    public ResponseUtil<Map<String, Object>> checkDwsAuthStatusBySource(@RequestBody Map<String, Object> params) {
        Long sourceId = Long.valueOf(params.get("sourceId").toString());
        return applicationService.checkDwsAuthStatusBySource(sourceId);
    }

    /** 查询启用的运营任务模板卡片，可按模板类型筛选。 */
    @PostMapping("/operation/task-template/list")
    public ResponseUtil<List<OperationTaskTemplate>> listOperationTaskTemplates(
        @RequestBody Map<String, Object> params) {
        return applicationService.listOperationTaskTemplates(MapParamUtil.getStringValue(params, "templateType"));
    }

    /** 查询单个运营任务模板详情。 */
    @PostMapping("/operation/task-template/get")
    public ResponseUtil<OperationTaskTemplate> getOperationTaskTemplate(@RequestBody Map<String, Object> params) {
        return applicationService.getOperationTaskTemplate(MapParamUtil.getLongValue(params, "templateId"));
    }

    /** 创建运营需求，写入扫描源表并通过运营 source_type 与研发渠道隔离。 */
    @PostMapping("/requirement/createOperationRequirement")
    public ResponseUtil<Map<String, Object>> createOperationRequirement(@RequestBody OperationRequirementDTO dto) {
        return applicationService.createOperationRequirement(dto);
    }

    /** 修改尚未启动的运营需求。 */
    @PostMapping("/requirement/updateOperationRequirement")
    public ResponseUtil<Void> updateOperationRequirement(@RequestBody OperationRequirementDTO dto) {
        return applicationService.updateOperationRequirement(dto);
    }

    /** 分页查询运营项目需求，支持按名称忽略大小写模糊搜索。 */
    @PostMapping("/requirement/operation/list")
    public ResponseUtil<PageInfo<Map<String, Object>>> listOperationRequirements(
        @RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        String keyword = MapParamUtil.getStringValue(params, "keyword");
        int pageNum = Math.max(1, MapParamUtil.getIntValue(params, "pageNum", 1));
        int pageSize = Math.max(1, MapParamUtil.getIntValue(params, "pageSize", 30));
        return applicationService.listOperationRequirements(projectId, keyword, pageNum, pageSize);
    }

    /** 查询单条运营需求详情。 */
    @PostMapping("/requirement/operation/get")
    public ResponseUtil<Map<String, Object>> getOperationRequirement(@RequestBody Map<String, Object> params) {
        return applicationService.getOperationRequirement(MapParamUtil.getLongValue(params, "itemId"));
    }

    /** 删除运营需求；仅需求创建人可操作。 */
    @PostMapping("/requirement/operation/delete")
    public ResponseUtil<Void> deleteOperationRequirement(@RequestBody Map<String, Object> params) {
        return applicationService.deleteOperationRequirement(MapParamUtil.getLongValue(params, "itemId"));
    }

    /** 启动运营需求并提交用户确认后的任务拆解结果。 */
    @PostMapping("/requirement/operation/start")
    public ResponseUtil<List<Map<String, Object>>> startOperationRequirement(
        @RequestBody OperationRequirementStartDTO dto) {
        return applicationService.startOperationRequirement(dto);
    }

    /** 分页查询运营项目已拆解的任务，支持日期、状态和可选的当前负责人筛选。 */
    @PostMapping("/operation/task/list")
    public ResponseUtil<PageInfo<Map<String, Object>>> listOperationTasks(@RequestBody Map<String, Object> params) {
        Long projectId = MapParamUtil.getLongValue(params, "projectId");
        String keyword = MapParamUtil.getStringValue(params, "keyword");
        boolean onlyMine = Boolean.parseBoolean(String.valueOf(params.getOrDefault("onlyMine", false)));
        String createTimeStart = MapParamUtil.getStringValue(params, "createTimeStart");
        String createTimeEnd = MapParamUtil.getStringValue(params, "createTimeEnd");
        String status = MapParamUtil.getStringValue(params, "status");
        int pageNum = Math.max(1, MapParamUtil.getIntValue(params, "pageNum", 1));
        int pageSize = Math.max(1, MapParamUtil.getIntValue(params, "pageSize", 30));
        return applicationService.listOperationTasks(projectId, keyword, onlyMine, createTimeStart, createTimeEnd,
            status, pageNum, pageSize);
    }

    /** 查询单条运营任务详情。 */
    @PostMapping("/operation/task/get")
    public ResponseUtil<Map<String, Object>> getOperationTask(@RequestBody Map<String, Object> params) {
        return applicationService.getOperationTask(MapParamUtil.getLongValue(params, "taskId"));
    }

    /** 修改尚未开始的运营任务。 */
    @PostMapping("/operation/task/update")
    public ResponseUtil<Void> updateOperationTask(@RequestBody OperationTaskDTO dto) {
        return applicationService.updateOperationTask(dto);
    }

    /** 删除运营任务；仅任务创建人可操作，已执行任务保留会话成果。 */
    @PostMapping("/operation/task/delete")
    public ResponseUtil<Void> deleteOperationTask(@RequestBody Map<String, Object> params) {
        return applicationService.deleteOperationTask(MapParamUtil.getLongValue(params, "taskId"));
    }

    /** 确认执行数字员工并启动已拆解的运营任务会话。 */
    @PostMapping("/operation/task/execute")
    public ResponseUtil<Map<String, Object>> executeOperationTask(@RequestBody OperationTaskDTO dto) {
        return applicationService.executeOperationTask(dto);
    }

    /** 查询运营项目已绑定的平台账号。 */
    @PostMapping("/operation/account/list")
    public ResponseUtil<List<Map<String, Object>>> listOperationAccounts(@RequestBody Map<String, Object> params) {
        return applicationService.listOperationAccounts(MapParamUtil.getLongValue(params, "projectId"));
    }

    /** 新增运营平台账号。 */
    @PostMapping("/operation/account/create")
    public ResponseUtil<Map<String, Object>> createOperationAccount(@RequestBody OperationAccountDTO dto) {
        return applicationService.createOperationAccount(dto);
    }

    /** 编辑运营平台账号的展示信息和平台侧账号标识。 */
    @PostMapping("/operation/account/update")
    public ResponseUtil<Void> updateOperationAccount(@RequestBody OperationAccountDTO dto) {
        return applicationService.updateOperationAccount(dto);
    }

    /** 删除运营平台账号，后端使用软删除保留历史业务引用。 */
    @PostMapping("/operation/account/delete")
    public ResponseUtil<Void> deleteOperationAccount(@RequestBody Map<String, Object> params) {
        return applicationService.deleteOperationAccount(MapParamUtil.getLongValue(params, "accountId"));
    }

    /** 校验当前用户的采集沙箱，并更新运营账号登录状态。 */
    @PostMapping("/operation/account/login")
    public ResponseUtil<Map<String, Object>> loginOperationAccount(@RequestBody Map<String, Object> params) {
        return applicationService.loginOperationAccount(MapParamUtil.getLongValue(params, "accountId"),
            MapParamUtil.getStringValue(params, "sandboxId"));
    }

    /** 根据知识库资源 ID 分页查询对象基本信息，可选按知识库目录列表和对象名称进一步过滤。返回结果不包含对象的 properties 和 actions。 */
    @PostMapping("/operation/queryObjectsByKnowledge")
    public ResponseUtil<QueryByKnowledgeResp> queryObjectsByKnowledge(@RequestBody QueryByKnowledgeReq paramReq) {
        QueryByKnowledgeResp queryByKnowledgeResp = applicationService.queryObjectsByKnowledge(paramReq);
        return ResponseUtil.successResponse(queryByKnowledgeResp);
    }

    /**
     * 保存对象实例到知识库
     *
     * @param request 请求头
     * @param params 入参
     * @return ResponseUtil
     */
    @PostMapping("/operation/saveObjectInstanceToKb")
    public ResponseUtil<InvokeActionResp> saveObjectInstanceToKb(HttpServletRequest request,
        @RequestBody Params params) {

        // 如果参数中为null,从请求头中获取
        if (params.getSessionId() == null) {
            String XSessionId = request.getHeader("X-Session-Id");
            params.setSessionId(StringUtil.isNum(XSessionId) ? Long.parseLong(XSessionId) : null);
        }

        InvokeActionResp invokeActionResp = applicationService.saveObjectInstanceToKb(params);
        return ResponseUtil.successResponse(invokeActionResp);
    }

    /**
     * 批量保存或更新项目业务对象关联文件。
     *
     * @param objectFileSaveDTO 对象文件列表
     * @return 保存后的实体列表
     */
    @PostMapping("/operation/saveOrUpdateObjectFiles")
    public ResponseUtil<List<ProjectObjectFile>> saveOrUpdateObjectFiles(
        @RequestBody ObjectFileSaveDTO objectFileSaveDTO) {
        List<ProjectObjectFile> projectObjectFiles = applicationService.saveOrUpdateObjectFiles(objectFileSaveDTO);
        return ResponseUtil.successResponse(projectObjectFiles);
    }

    /**
     * 按项目与会话查询业务对象关联文件，按 objectCode、objectName 归类返回。
     *
     * @param listObjectFileDto 查询条件
     * @return 归类后的文件组列表
     */
    @PostMapping("/operation/listProjectObjectFiles")
    public ResponseUtil<Collection<ObjectFileGroupDTO>> listProjectObjectFiles(
        @RequestBody ListObjectFileDto listObjectFileDto) {
        Collection<ObjectFileGroupDTO> resultList = applicationService.listProjectObjectFiles(listObjectFileDto);
        return ResponseUtil.successResponse(resultList);
    }

    /**
     * 查询运营任务对象信息
     *
     * @param listObjectFilePkIdDto 查询入参
     * @return ResponseUtil
     */
    @PostMapping("/operation/listObjectById")
    public ResponseUtil<List<Map<String, Object>>> listObjectById(
        @RequestBody ListObjectFilePkIdDto listObjectFilePkIdDto) {
        List<Map<String, Object>> resultList = applicationService.listObjectById(listObjectFilePkIdDto);
        return ResponseUtil.successResponse(resultList);
    }

    /**
     * 更新运营任务状态
     *
     * @param updateTaskStatusDto 更新入参
     */
    @PostMapping("/operation/updateTaskStatus")
    public ResponseUtil<Void> updateTaskStatus(@RequestBody UpdateTaskStatusDto updateTaskStatusDto) {
        applicationService.updateTaskStatus(updateTaskStatusDto);
        return ResponseUtil.successResponse();
    }

    /**
     * 查询项目任务状态字典，供会话扩展状态 skill 使用。
     *
     * @param listProjectTaskStatusDto 项目与可选维度
     * @return 有效状态列表
     */
    @PostMapping("/project/taskStatuses/list")
    public ResponseUtil<List<ProjectTaskStatus>> listProjectTaskStatuses(
        @RequestBody ListProjectTaskStatusDto listProjectTaskStatusDto) {
        return ResponseUtil.successResponse(applicationService.listProjectTaskStatuses(listProjectTaskStatusDto));
    }

}
