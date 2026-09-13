package com.iwhalecloud.byai.manager.domain.devloop.service;

import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;

/**
 * 本地 Git 变更结果到前端代码变更视图结构的转换。
 *
 * <p>数据库仓库（会话任务口径）与项目空间未登记仓库共用同一套字段形状，前端渲染分支才能只有一份。
 * 字段增删必须同步前端 DevloopTaskChanges 类型。</p>
 */
public final class LocalGitChangeViewMapper {

    private LocalGitChangeViewMapper() {
    }

    /** 工作区不可用时的空态：status=ok + 空列表，前端按“暂无改动”展示。 */
    public static Map<String, Object> emptyChanges() {
        Map<String, Object> map = new HashMap<>();
        map.put("status", "ok");
        map.put("source", "local");
        map.put("files", new ArrayList<>());
        map.put("fileCount", 0);
        return map;
    }

    /** 查询失败时的兜底空态：status=http_error，前端展示“暂时无法获取代码变更”，不报错。 */
    public static Map<String, Object> errorChanges() {
        Map<String, Object> map = new HashMap<>();
        map.put("status", "http_error");
        map.put("files", new ArrayList<>());
        map.put("fileCount", 0);
        return map;
    }

    /** 将本地变更采集结果转换成前端代码变更视图结构。 */
    public static Map<String, Object> toChangesMap(LocalGitChangeService.LocalChangeResult result,
        String repoFullName) {
        Map<String, Object> map = new HashMap<>();
        map.put("status", "ok");
        // 标记来源为本地，便于前端在需要时提示“含未推送改动”；不识别该字段也不影响渲染。
        map.put("source", "local");
        map.put("repoFullName", repoFullName);
        map.put("baseBranch", result.getBaseBranch());
        map.put("headBranch", result.getHeadBranch());
        map.put("compareUrl", null);
        map.put("message", result.getMessage());
        List<Map<String, Object>> files = new ArrayList<>();
        for (LocalGitChangeService.LocalFileChange file : result.getFiles()) {
            Map<String, Object> item = new HashMap<>();
            item.put("filename", file.getFilename());
            item.put("status", file.getStatus());
            item.put("additions", file.getAdditions());
            item.put("deletions", file.getDeletions());
            item.put("previousFilename", file.getPreviousFilename());
            item.put("blobUrl", null);
            files.add(item);
        }
        map.put("files", files);
        map.put("fileCount", files.size());
        return map;
    }

    /** 单文件 diff 结果转换；status 非 ok 时前端提示不可用。 */
    public static Map<String, Object> toFileDiffMap(LocalGitChangeService.FileDiffResult result) {
        Map<String, Object> map = new HashMap<>();
        map.put("status", result.getStatus().name().toLowerCase());
        map.put("filename", result.getFilename());
        map.put("diff", result.getDiff());
        map.put("message", result.getMessage());
        return map;
    }

    /** diff 查询抛异常时的兜底：status=git_error，前端提示不可用。 */
    public static Map<String, Object> errorFileDiff(String filePath) {
        Map<String, Object> map = new HashMap<>();
        map.put("status", "git_error");
        map.put("filename", filePath);
        map.put("diff", null);
        return map;
    }
}
