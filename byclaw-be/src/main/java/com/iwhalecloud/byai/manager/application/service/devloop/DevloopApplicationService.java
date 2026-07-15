package com.iwhalecloud.byai.manager.application.service.devloop;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.manager.application.service.job.DevloopPatService;
import com.iwhalecloud.byai.manager.domain.devloop.service.DingtalkScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.GitHubIssueScanService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanLogService;
import com.iwhalecloud.byai.manager.domain.devloop.service.ScanSourceService;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ProjectRepoDTO;
import com.iwhalecloud.byai.manager.dto.devloop.ScanSourceDTO;
import com.iwhalecloud.byai.manager.entity.devloop.*;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectMapper;
import com.iwhalecloud.byai.manager.mapper.devloop.ProjectRepoMapper;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

import java.util.*;

/**
 * 研发闭环应用服务
 * 聚合项目管理、扫描源管理、扫描执行、日志查询、PAT管理、钉钉群搜索等业务逻辑
 */
@Slf4j
@Service
public class DevloopApplicationService {

    @Autowired
    private ProjectMapper projectMapper;

    @Autowired
    private ProjectRepoMapper projectRepoMapper;

    @Autowired
    private ScanSourceService scanSourceService;

    @Autowired
    private ScanLogService scanLogService;

    @Autowired
    private GitHubIssueScanService gitHubIssueScanService;

    @Autowired
    private DingtalkScanService dingtalkScanService;

    @Autowired
    private DevloopPatService patService;

    @Autowired
    private SequenceService sequenceService;

    /** 创建项目，可同时关联代码仓库 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Map<String, Object>> createProject(ProjectDTO dto) {
        Project project = new Project();
        project.setProjectId(sequenceService.nextVal());
        project.setProjectName(dto.getProjectName());
        project.setDescription(dto.getDescription());
        project.setResourceId(dto.getResourceId());
        project.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        project.setCreateTime(new Date());
        project.setDeleteFlag("0");
        projectMapper.insert(project);

        if (dto.getRepos() != null) {
            for (ProjectRepoDTO repoDto : dto.getRepos()) {
                ProjectRepo repo = new ProjectRepo();
                repo.setRepoId(sequenceService.nextVal());
                repo.setProjectId(project.getProjectId());
                repo.setRepoFullName(repoDto.getRepoFullName());
                repo.setRepoUrl(repoDto.getRepoUrl());
                repo.setDefaultBranch(repoDto.getDefaultBranch() != null
                    ? repoDto.getDefaultBranch() : "main");
                repo.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
                repo.setCreateTime(new Date());
                projectRepoMapper.insert(repo);
            }
        }

        Map<String, Object> result = new HashMap<>();
        result.put("projectId", project.getProjectId());
        return ResponseUtil.successResponse(result);
    }

    /** 查询项目列表，按创建时间倒序 */
    public ResponseUtil<List<Map<String, Object>>> listProjects() {
        LambdaQueryWrapper<Project> wrapper = new LambdaQueryWrapper<>();
        wrapper.eq(Project::getDeleteFlag, "0")
               .orderByDesc(Project::getCreateTime);
        List<Project> projects = projectMapper.selectList(wrapper);

        List<Map<String, Object>> list = new ArrayList<>();
        for (Project p : projects) {
            Map<String, Object> map = new HashMap<>();
            map.put("projectId", p.getProjectId());
            map.put("projectName", p.getProjectName());
            map.put("description", p.getDescription());
            map.put("resourceId", p.getResourceId());
            map.put("createTime", p.getCreateTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 修改项目名称或描述 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> updateProject(ProjectDTO dto) {
        Project project = projectMapper.selectById(dto.getProjectId());
        if (project == null || "1".equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        if (dto.getProjectName() != null) {
            project.setProjectName(dto.getProjectName());
        }
        if (dto.getDescription() != null) {
            project.setDescription(dto.getDescription());
        }
        project.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        project.setUpdateTime(new Date());
        projectMapper.updateById(project);
        return ResponseUtil.successResponse(null);
    }

    /** 软删除项目 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> deleteProject(Long projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null || "1".equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        project.setDeleteFlag("1");
        project.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        project.setUpdateTime(new Date());
        projectMapper.updateById(project);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目详情，含关联仓库列表 */
    public ResponseUtil<Map<String, Object>> getProject(Long projectId) {
        Project project = projectMapper.selectById(projectId);
        if (project == null || "1".equals(project.getDeleteFlag())) {
            return ResponseUtil.failRes("Project not found");
        }
        LambdaQueryWrapper<ProjectRepo> repoWrapper = new LambdaQueryWrapper<>();
        repoWrapper.eq(ProjectRepo::getProjectId, projectId);
        List<ProjectRepo> repos = projectRepoMapper.selectList(repoWrapper);

        Map<String, Object> map = new HashMap<>();
        map.put("projectId", project.getProjectId());
        map.put("projectName", project.getProjectName());
        map.put("description", project.getDescription());
        map.put("resourceId", project.getResourceId());
        map.put("repos", repos);
        return ResponseUtil.successResponse(map);
    }

    /** 创建扫描源 */
    public ResponseUtil<Map<String, Object>> createScanSource(ScanSourceDTO dto) {
        ScanSource source = new ScanSource();
        source.setProjectId(dto.getProjectId());
        source.setSourceName(dto.getSourceName());
        source.setSourceType(dto.getSourceType());
        source.setConfig(dto.getConfig());
        source.setCronExpr(dto.getCronExpr());
        source.setEnabled(dto.getEnabled() != null ? dto.getEnabled() : "1");
        source.setCreateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        ScanSource created = scanSourceService.create(source);

        Map<String, Object> result = new HashMap<>();
        result.put("sourceId", created.getSourceId());
        return ResponseUtil.successResponse(result);
    }

    /** 修改扫描源配置（名称、config、cron） */
    public ResponseUtil<Void> updateScanSource(ScanSourceDTO dto) {
        ScanSource source = new ScanSource();
        source.setSourceId(dto.getSourceId());
        source.setSourceName(dto.getSourceName());
        source.setConfig(dto.getConfig());
        source.setCronExpr(dto.getCronExpr());
        source.setUpdateBy(String.valueOf(CurrentUserHolder.getCurrentUserId()));
        scanSourceService.update(source);
        return ResponseUtil.successResponse(null);
    }

    /** 删除扫描源 */
    public ResponseUtil<Void> deleteScanSource(Long sourceId) {
        scanSourceService.delete(sourceId);
        return ResponseUtil.successResponse(null);
    }

    /** 查询项目下的扫描源列表 */
    public ResponseUtil<List<Map<String, Object>>> listScanSources(Long projectId) {
        List<ScanSource> sources = scanSourceService.listByProjectId(projectId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanSource s : sources) {
            Map<String, Object> map = new HashMap<>();
            map.put("sourceId", s.getSourceId());
            map.put("sourceName", s.getSourceName());
            map.put("sourceType", s.getSourceType());
            map.put("config", s.getConfig());
            map.put("cronExpr", s.getCronExpr());
            map.put("enabled", s.getEnabled());
            map.put("lastScanTime", s.getLastScanTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 启用或停用扫描源 */
    public ResponseUtil<Void> toggleScanSource(Long sourceId, String enabled) {
        ScanSource source = new ScanSource();
        source.setSourceId(sourceId);
        source.setEnabled(enabled);
        scanSourceService.update(source);
        return ResponseUtil.successResponse(null);
    }

    /** 手动触发一次扫描，根据源类型调用对应扫描服务 */
    public ResponseUtil<Map<String, Object>> triggerScan(Long sourceId) {
        ScanSource source = scanSourceService.findById(sourceId);
        if (source == null) {
            return ResponseUtil.failRes("Source not found");
        }

        List<ScanLogItem> items;
        String type = source.getSourceType();
        if ("github_issue".equals(type)) {
            String pat = patService.getGitHubPat(source.getCreateBy());
            if (pat == null) {
                return ResponseUtil.failRes("GitHub PAT not configured");
            }
            items = gitHubIssueScanService.scan(source, pat);
        } else if ("dingtalk".equals(type)) {
            items = dingtalkScanService.scan(source);
        } else {
            return ResponseUtil.failRes("Unknown source type: " + type);
        }

        Map<String, Object> result = new HashMap<>();
        result.put("createdCount", items.size());
        return ResponseUtil.successResponse(result);
    }

    /** 查询扫描日志列表 */
    public ResponseUtil<List<Map<String, Object>>> listScanLogs(
            Long sourceId, int limit) {
        List<ScanLog> logs = scanLogService.listBySourceId(sourceId, limit);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLog l : logs) {
            Map<String, Object> map = new HashMap<>();
            map.put("logId", l.getLogId());
            map.put("scanTime", l.getScanTime());
            map.put("foundCount", l.getFoundCount());
            map.put("createdCount", l.getCreatedCount());
            map.put("status", l.getStatus());
            map.put("errorMsg", l.getErrorMsg());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    /** 查询单次扫描的详细条目 */
    public ResponseUtil<List<Map<String, Object>>> listScanLogItems(Long logId) {
        List<ScanLogItem> items = scanLogService.listItemsByLogId(logId);
        List<Map<String, Object>> list = new ArrayList<>();
        for (ScanLogItem item : items) {
            Map<String, Object> map = new HashMap<>();
            map.put("itemId", item.getItemId());
            map.put("title", item.getTitle());
            map.put("originId", item.getOriginId());
            map.put("originUrl", item.getOriginUrl());
            map.put("action", item.getAction());
            map.put("createTime", item.getCreateTime());
            list.add(map);
        }
        return ResponseUtil.successResponse(list);
    }

    @Autowired
    private com.iwhalecloud.byai.manager.mapper.users.UserPrivateParamMapper userPrivateParamMapper;

    /** 保存GitHub PAT，SM4加密存储 */
    @Transactional(rollbackFor = Exception.class)
    public ResponseUtil<Void> saveGitHubPat(String pat) {
        Long userId = CurrentUserHolder.getCurrentUserId();
        String paramKey = "github_pat";

        LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UserPrivateParam> wrapper =
            new LambdaQueryWrapper<>();
        wrapper.eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getUserId, userId)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getParamKey, paramKey)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getDeleteFlag, "0");

        var existing = userPrivateParamMapper.selectOne(wrapper);
        String encrypted = com.iwhalecloud.byai.common.ecrypt.Sm4Util.encrypt(pat);
        String last4 = pat.length() > 4 ? pat.substring(pat.length() - 4) : pat;

        if (existing != null) {
            existing.setParamValueCipher(encrypted);
            existing.setParamValueLast4(last4);
            existing.setUpdateTime(new Date());
            userPrivateParamMapper.updateById(existing);
        } else {
            var param = new com.iwhalecloud.byai.manager.entity.users.UserPrivateParam();
            param.setParamId(sequenceService.nextVal());
            param.setUserId(userId);
            param.setParamKey(paramKey);
            param.setParamValueCipher(encrypted);
            param.setParamValueLast4(last4);
            param.setDescription("GitHub Personal Access Token");
            param.setStatus("1");
            param.setCreateTime(new Date());
            param.setDeleteFlag("0");
            userPrivateParamMapper.insert(param);
        }
        return ResponseUtil.successResponse(null);
    }

    /** 检查当前用户是否已配置GitHub PAT */
    public ResponseUtil<Map<String, Object>> checkGitHubPat() {
        Long userId = CurrentUserHolder.getCurrentUserId();
        String paramKey = "github_pat";

        LambdaQueryWrapper<com.iwhalecloud.byai.manager.entity.users.UserPrivateParam> wrapper =
            new LambdaQueryWrapper<>();
        wrapper.eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getUserId, userId)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getParamKey, paramKey)
               .eq(com.iwhalecloud.byai.manager.entity.users.UserPrivateParam::getDeleteFlag, "0");

        var existing = userPrivateParamMapper.selectOne(wrapper);
        Map<String, Object> result = new HashMap<>();
        result.put("hasPat", existing != null);
        if (existing != null) {
            result.put("last4", existing.getParamValueLast4());
        }
        return ResponseUtil.successResponse(result);
    }

    @org.springframework.beans.factory.annotation.Value("${devloop.dws.bin:dws}")
    private String dwsBin;

    /** 通过DWS CLI搜索钉钉群 */
    public ResponseUtil<List<Map<String, Object>>> searchDingtalkGroups(String query) {
        List<Map<String, Object>> groups = new ArrayList<>();
        try {
            List<String> cmd = new ArrayList<>();
            cmd.add(dwsBin);
            cmd.add("chat");
            cmd.add("search");
            cmd.add("--query");
            cmd.add(query);
            cmd.add("--format");
            cmd.add("json");

            ProcessBuilder pb = new ProcessBuilder(cmd);
            pb.redirectErrorStream(true);
            Process process = pb.start();

            StringBuilder output = new StringBuilder();
            try (var reader = new java.io.BufferedReader(
                    new java.io.InputStreamReader(process.getInputStream()))) {
                String line;
                while ((line = reader.readLine()) != null) {
                    output.append(line);
                }
            }

            boolean finished = process.waitFor(30, java.util.concurrent.TimeUnit.SECONDS);
            if (!finished) {
                process.destroyForcibly();
                return ResponseUtil.failRes("搜索超时");
            }

            var mapper = new com.fasterxml.jackson.databind.ObjectMapper();
            com.fasterxml.jackson.databind.JsonNode root = mapper.readTree(output.toString());
            com.fasterxml.jackson.databind.JsonNode groupsNode = root.path("result").path("groups");
            if (groupsNode.isArray()) {
                for (com.fasterxml.jackson.databind.JsonNode conv : groupsNode) {
                    Map<String, Object> g = new HashMap<>();
                    g.put("openConversationId", conv.path("openConversationId").asText(""));
                    g.put("name", conv.path("title").asText(""));
                    groups.add(g);
                }
            }
        } catch (Exception e) {
            log.error("DingTalk group search failed", e);
            return ResponseUtil.failRes("搜索失败: " + e.getMessage());
        }
        return ResponseUtil.successResponse(groups);
    }
}
