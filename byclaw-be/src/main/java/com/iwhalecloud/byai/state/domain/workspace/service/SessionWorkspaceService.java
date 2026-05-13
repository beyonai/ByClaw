package com.iwhalecloud.byai.state.domain.workspace.service;

import com.baomidou.mybatisplus.core.conditions.query.LambdaQueryWrapper;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceBatchCreateRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceCreateRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceFileItem;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceListRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceResponse;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDir;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDirRel;
import com.iwhalecloud.byai.manager.entity.showcase.ByaiShowcase;
import com.iwhalecloud.byai.manager.entity.workspace.ByaiSessionWorkspace;
import com.iwhalecloud.byai.manager.mapper.searchask.SpaceDirMapper;
import com.iwhalecloud.byai.manager.mapper.searchask.SpaceDirRelMapper;
import com.iwhalecloud.byai.manager.mapper.showcase.ByaiShowcaseMapper;
import com.iwhalecloud.byai.manager.mapper.workspace.ByaiSessionWorkspaceMapper;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDataType;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDirType;
import com.iwhalecloud.byai.common.exception.BaseException;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.state.domain.showcase.service.ShowcaseService;
import com.iwhalecloud.byai.state.domain.showcase.strategy.FileShowcaseStrategy;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import java.util.ArrayList;
import java.util.Date;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.stream.Collectors;
import org.apache.commons.collections.MapUtils;
import org.apache.commons.lang3.StringUtils;
import org.springframework.beans.BeanUtils;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * 会话工作区服务
 *
 * @author system
 */
@Service
public class SessionWorkspaceService {

    private final ByaiSessionWorkspaceMapper byaiSessionWorkspaceMapper;

    private final ByaiShowcaseMapper byaiShowcaseMapper;

    private final SequenceService sequenceService;

    private final FileShowcaseStrategy fileShowcaseStrategy;

    private final SpaceDirMapper spaceDirMapper;

    private final SpaceDirRelMapper spaceDirRelMapper;

    public SessionWorkspaceService(ByaiSessionWorkspaceMapper byaiSessionWorkspaceMapper,
        ByaiShowcaseMapper byaiShowcaseMapper, SequenceService sequenceService, ShowcaseService showcaseService,
        FileShowcaseStrategy fileShowcaseStrategy, SpaceDirMapper spaceDirMapper, SpaceDirRelMapper spaceDirRelMapper) {
        this.byaiSessionWorkspaceMapper = byaiSessionWorkspaceMapper;
        this.byaiShowcaseMapper = byaiShowcaseMapper;
        this.sequenceService = sequenceService;
        this.fileShowcaseStrategy = fileShowcaseStrategy;
        this.spaceDirMapper = spaceDirMapper;
        this.spaceDirRelMapper = spaceDirRelMapper;
    }

    /**
     * 新增会话工作区记录
     *
     * @param request 新增请求
     * @return 主键 id
     */
    @Transactional(rollbackFor = Exception.class)
    public Long create(SessionWorkspaceCreateRequest request) {
        ByaiSessionWorkspace entity = new ByaiSessionWorkspace();
        entity.setId(sequenceService.nextVal());
        entity.setSessionId(request.getSessionId());
        entity.setName(request.getName());
        entity.setRelCount(request.getRelCount() != null ? request.getRelCount() : 0);
        entity.setFileId(request.getFileId());
        entity.setFileUrl(request.getFileUrl());
        entity.setIcon(request.getIcon());
        entity.setCreateTime(new Date());
        entity.setCreateBy(CurrentUserHolder.getCurrentUserId());
        byaiSessionWorkspaceMapper.insert(entity);
        return entity.getId();
    }

    /**
     * 批量新增会话工作区记录 sessionId、relCount 公用，每条文件项（name、fileId、fileUrl、icon）各存一条，使用批量插入
     *
     * @param request 批量新增请求
     * @return 新增记录的主键 id 列表
     */
    public List<ByaiSessionWorkspace> createBatch(SessionWorkspaceBatchCreateRequest request) {
        Long sessionId = request.getSessionId();
        int relCount = request.getRelCount() != null ? request.getRelCount() : 0;
        Long createBy = CurrentUserHolder.getCurrentUserId();
        Date now = new Date();
        List<Long> ids = new ArrayList<>();
        List<ByaiSessionWorkspace> entities = new ArrayList<>(request.getFileList().size());
        for (SessionWorkspaceFileItem item : request.getFileList()) {
            ByaiSessionWorkspace entity = new ByaiSessionWorkspace();
            entity.setId(sequenceService.nextVal());
            entity.setSessionId(sessionId);
            entity.setRelCount(relCount);
            entity.setName(item.getName());
            entity.setFileId(item.getFileId());
            entity.setFileUrl(item.getFileUrl());
            entity.setIcon(item.getIcon());
            entity.setCreateTime(now);
            entity.setCreateBy(createBy);
            ids.add(entity.getId());
            entities.add(entity);
        }
        if (!entities.isEmpty()) {
            byaiSessionWorkspaceMapper.insertBatch(entities);
        }
        return entities;
    }

    /**
     * 批量将会话工作区中的文件保存到成果空间 先按 workspaceIds 批量查询工作区，组装 ByaiShowcase 列表后批量插入，再批量更新工作区 is_exist=1
     *
     * @param workspaceIds 会话工作区记录 id 列表（byai_session_workspace 主键）
     * @return 成果空间主键 id 列表，与 workspaceIds 顺序一一对应
     */
    @Transactional(rollbackFor = Exception.class)
    public List<Long> saveWorkspaceFilesToShowcaseBatch(List<Long> workspaceIds) {
        if (workspaceIds == null || workspaceIds.isEmpty()) {
            return new ArrayList<>();
        }
        List<ByaiSessionWorkspace> workspaces = byaiSessionWorkspaceMapper
            .selectList(new LambdaQueryWrapper<ByaiSessionWorkspace>().in(ByaiSessionWorkspace::getId, workspaceIds));
        Map<Long, ByaiSessionWorkspace> map = workspaces.stream()
            .collect(Collectors.toMap(ByaiSessionWorkspace::getId, w -> w));
        List<ByaiSessionWorkspace> ordered = new ArrayList<>(workspaceIds.size());
        for (Long id : workspaceIds) {
            ByaiSessionWorkspace w = map.get(id);
            if (w == null) {
                throw new BaseException("工作区记录不存在: " + id);
            }
            ordered.add(w);
        }
        Date now = new Date();
        Long userId = CurrentUserHolder.getCurrentUserId();
        List<ByaiShowcase> showcaseList = new ArrayList<>(ordered.size());
        for (ByaiSessionWorkspace w : ordered) {
            ByaiShowcase s = new ByaiShowcase();
            s.setId(sequenceService.nextVal());
            s.setSessionId(w.getSessionId());
            s.setName(StringUtils.isNotBlank(w.getName()) ? w.getName() : "未命名文件");
            s.setFileId(w.getFileId());
            s.setUrl(w.getFileUrl());
            s.setStatus(1);
            s.setCreateTime(now);
            s.setUpdateTime(now);
            s.setCreateBy(userId);
            s.setUpdateBy(userId);
            detectType(w, s);
            showcaseList.add(s);
        }
        if (!showcaseList.isEmpty()) {
            byaiShowcaseMapper.insertBatch(showcaseList);
        }

        // 按成果类型归入对应的 byai_space_dir 目录：一次查询已有 → 批量创建缺失 → 批量插入关联
        batchBindShowcaseDirs(showcaseList, userId, now);

        byaiSessionWorkspaceMapper.updateIsExistByIds(workspaceIds);
        return showcaseList.stream().map(ByaiShowcase::getId).collect(Collectors.toList());
    }

    /**
     * 批量绑定成果到空间目录：先一次查询已有目录，再批量创建缺失目录，最后批量插入关联记录。
     *
     * @param showcaseList 成果列表
     * @param userId 当前用户 ID
     * @param now 当前时间
     */
    private void batchBindShowcaseDirs(List<ByaiShowcase> showcaseList, Long userId, Date now) {
        if (showcaseList.isEmpty()) {
            return;
        }
        // 1. 按 sessionId 收集所有需要的类型
        Set<String> typeSet = new HashSet<>();
        for (ByaiShowcase s : showcaseList) {
            String type = StringUtils.isNotBlank(s.getType()) ? s.getType() : "other";
            typeSet.add(type);
        }

        // 2. 按 sessionId 一次查询已有的 SHOWCASE 目录，构建 sessionId → (name → dirId)
        LambdaQueryWrapper<SpaceDir> dirQuery = new LambdaQueryWrapper<>();
        dirQuery.eq(SpaceDir::getDirType, SpaceDirType.DIR_TYPE_COLLECT);
        dirQuery.in(SpaceDir::getName, typeSet);
        List<SpaceDir> existingDirs = spaceDirMapper.selectList(dirQuery);
        Map<String, Long> nameToId = new HashMap<>();
        if (!existingDirs.isEmpty()) {
            nameToId = existingDirs.stream().filter(item -> item.getDirId() != null && item.getName() != null)
                .collect(Collectors.toMap(SpaceDir::getName, SpaceDir::getDirId));
        }

        // 得到需要创建的目录类型
        Set<String> types = getAddTypes(nameToId, typeSet);
        // 3. 批量创建缺失的目录
        List<SpaceDir> newDirs = new ArrayList<>();

        if (!types.isEmpty()) {
            for (String type : types) {
                SpaceDir dir = new SpaceDir();
                dir.setDirId(sequenceService.nextVal());
                dir.setParentDirId(-1L);
                dir.setName(type);
                dir.setDirType(SpaceDirType.DIR_TYPE_COLLECT);
                dir.setDescription(type);
                dir.setCreateBy(userId);
                dir.setCreateTime(now);
                dir.setUpdateTime(now);
                dir.setSort(0);
                newDirs.add(dir);
                nameToId.put(type, dir.getDirId());
            }
        }

        if (!newDirs.isEmpty()) {
            spaceDirMapper.insertBatch(newDirs);
        }

        // 4. 批量创建目录关联记录
        List<SpaceDirRel> relList = new ArrayList<>(showcaseList.size());
        for (ByaiShowcase s : showcaseList) {
            Long dirId = MapUtils.getLong(nameToId, s.getType());
            SpaceDirRel rel = new SpaceDirRel();
            rel.setDirRelId(sequenceService.nextVal());
            rel.setDirId(dirId);
            rel.setDataId(s.getId());
            rel.setDataType(SpaceDataType.DATA_TYPE_SHOWCASE);
            relList.add(rel);
        }
        if (!relList.isEmpty()) {
            spaceDirRelMapper.insertBatch(relList);
        }
    }

    private Set<String> getAddTypes(Map<String, Long> nameToId, Set<String> typeSet) {
        // 如果都没有存在的
        if (nameToId == null || nameToId.isEmpty()) {
            return typeSet;
        }
        // 否则就是取遍历的值
        Set<String> newTypeSet = new HashSet<>(typeSet);
        for (String type : typeSet) {
            if (!nameToId.containsKey(type)) {
                newTypeSet.add(type);
            }
        }
        return newTypeSet;
    }

    /**
     * 根据主键删除会话工作区记录
     *
     * @param id 会话工作区记录主键
     */
    public void deleteById(Long id) {
        ByaiSessionWorkspace workspace = byaiSessionWorkspaceMapper.selectById(id);
        if (workspace == null) {
            throw new BaseException("工作区记录不存在: " + id);
        }
        byaiSessionWorkspaceMapper.deleteById(id);
    }

    /**
     * 修改会话工作区记录名称
     *
     * @param id 会话工作区记录主键
     * @param name 新的文件名称
     */
    public void updateName(Long id, String name) {
        ByaiSessionWorkspace workspace = byaiSessionWorkspaceMapper.selectById(id);
        if (workspace == null) {
            throw new BaseException("工作区记录不存在: " + id);
        }
        workspace.setName(name);
        byaiSessionWorkspaceMapper.updateById(workspace);
    }

    private void detectType(ByaiSessionWorkspace workspace, ByaiShowcase showcase) {
        FileShowcaseStrategy.FilePayload payload = new FileShowcaseStrategy.FilePayload();
        payload.setFileId(workspace.getFileId());
        payload.setFileUrl(workspace.getFileUrl());
        payload.setFileName(workspace.getName());
        showcase.setType(fileShowcaseStrategy.detectFileType(payload));
    }

    /**
     * 按会话 id 查询工作区列表
     *
     * @return 工作区列表
     */
    public List<SessionWorkspaceResponse> listBySessionId(SessionWorkspaceListRequest request) {

        List<ByaiSessionWorkspace> list = byaiSessionWorkspaceMapper.selectBySession(request);
        return list.stream().map(this::toResponse).collect(Collectors.toList());
    }

    private SessionWorkspaceResponse toResponse(ByaiSessionWorkspace entity) {
        SessionWorkspaceResponse dto = new SessionWorkspaceResponse();
        BeanUtils.copyProperties(entity, dto);
        return dto;
    }
}
