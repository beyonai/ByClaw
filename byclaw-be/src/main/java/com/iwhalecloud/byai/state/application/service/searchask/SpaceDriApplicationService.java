package com.iwhalecloud.byai.state.application.service.searchask;

import java.util.ArrayList;
import java.util.Collections;
import java.util.Date;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.manager.dto.searchask.SpaceDataDto;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceKbResourceVo;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import com.iwhalecloud.byai.manager.dto.searchask.SelectedDatasetDto;
import com.iwhalecloud.byai.manager.dto.searchask.SelectedDto;
import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDir;
import com.iwhalecloud.byai.manager.entity.searchask.SpaceDirRel;
import com.iwhalecloud.byai.manager.entity.session.ByaiSession;
import com.iwhalecloud.byai.manager.qo.searchask.CollectResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.EnterpriseKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.PersonalKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SelectedKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SkillResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.SpaceResourceQo;
import com.iwhalecloud.byai.manager.vo.searchask.EnterpriseKbVo;
import com.iwhalecloud.byai.manager.vo.searchask.ImportFilesVo;
import com.iwhalecloud.byai.manager.vo.searchask.ImportSelectedDatasetVo;
import com.iwhalecloud.byai.manager.vo.searchask.PersonalKbVo;
import com.iwhalecloud.byai.manager.vo.searchask.SelectedVo;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceResourceVo;
import com.iwhalecloud.byai.common.constants.chat.ConversationObjectType;
import com.iwhalecloud.byai.common.constants.files.FileStatus;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDataType;
import com.iwhalecloud.byai.common.constants.searchask.SpaceDirType;
import com.iwhalecloud.byai.common.login.auth.CurrentUserHolder;
import com.iwhalecloud.byai.common.page.PageInfo;
import com.iwhalecloud.byai.common.util.DateUtils;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.state.domain.file.service.FileService;
import com.iwhalecloud.byai.state.domain.resource.bo.AuthContextBo;
import com.iwhalecloud.byai.state.domain.resource.service.ResourceAuthContextService;
import com.iwhalecloud.byai.state.domain.searchask.service.SpaceDirRelService;
import com.iwhalecloud.byai.state.domain.searchask.service.SpaceDirService;
import com.iwhalecloud.byai.state.domain.session.enums.SessionType;
import com.iwhalecloud.byai.state.domain.session.service.SessionService;
import com.iwhalecloud.byai.state.domain.sys.service.SequenceService;
import com.iwhalecloud.byai.common.storage.FileIngressService;
import com.iwhalecloud.byai.common.storage.model.FileMetadata;
import com.iwhalecloud.byai.common.storage.model.FileStorageContext;

/**
 * @author he.duming
 * @date 2026-03-04 09:30:04
 * @description TODO
 */
@Service
public class SpaceDriApplicationService {

    @Autowired
    private FileService fileService;

    @Autowired
    private SpaceDirService spaceDirService;

    @Autowired
    private SpaceDirRelService spaceDriRelService;

    @Autowired
    private FileIngressService fileIngressService;

    @Autowired
    private SequenceService sequenceService;

    @Autowired
    private ResourceAuthContextService resourceAuthContextService;

    @Autowired
    private SessionService sessionService;

    /**
     * 查询导入对象
     *
     * @param importResourceQo 查询
     * @return ResponseUtil
     */
    public List<SpaceResourceVo> listImportResource(SpaceResourceQo importResourceQo) {
        // 如果没传指定会话的，不查询
        if (importResourceQo.getSessionId() == null) {
            return Collections.emptyList();
        }

        importResourceQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
        return spaceDirService.listImportResource(importResourceQo);
    }

    /**
     * 个人知识库
     *
     * @param personalKbQo 查询对象
     * @return ResponseUtil
     */
    public PersonalKbVo listPersonalKb(PersonalKbQo personalKbQo) {

        // 查询个人知识库中已经选择的
        SelectedKbQo selectedKbQo = new SelectedKbQo();
        selectedKbQo.setDirType(SpaceDirType.DIR_TYPE_PERSONAL_KB);
        selectedKbQo.setSessionId(personalKbQo.getSessionId());
        List<SpaceKbResourceVo> selectedKbs = spaceDirService.listSelectedKb(selectedKbQo);

        // 查询个人创建的
        personalKbQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
        PageInfo<SpaceResourceVo> pageInfo = spaceDirService.listPersonalKb(personalKbQo);

        // 构建返回
        PersonalKbVo personalKbVo = new PersonalKbVo();
        personalKbVo.setPageInfo(pageInfo);
        personalKbVo.setSelectedKbs(selectedKbs);
        return personalKbVo;
    }

    /**
     * 企业知识库
     *
     * @param enterpriseKbQo 查询对象
     * @return ResponseUtil
     */
    public EnterpriseKbVo listEnterpriseKb(EnterpriseKbQo enterpriseKbQo) {

        // 查询企业知识库中已经选择的
        SelectedKbQo selectedKbQo = new SelectedKbQo();
        selectedKbQo.setDirType(SpaceDirType.DIR_TYPE_ENTERPRISE_KB);
        selectedKbQo.setSessionId(enterpriseKbQo.getSessionId());
        List<SpaceKbResourceVo> selectedKbs = spaceDirService.listSelectedKb(selectedKbQo);

        // 用户授权信息
        enterpriseKbQo.setUserId(CurrentUserHolder.getCurrentUserId());
        enterpriseKbQo.setUserStationId(CurrentUserHolder.getUserStationId());
        enterpriseKbQo.setUserOrgIds(CurrentUserHolder.getUserOrgIds());
        enterpriseKbQo.setUserPositionIds(CurrentUserHolder.getUserPositionIds());
        PageInfo<SpaceKbResourceVo> pageInfo = spaceDirService.listEnterpriseKb(enterpriseKbQo);

        // 构建返回
        EnterpriseKbVo enterpriseKbVo = new EnterpriseKbVo();
        enterpriseKbVo.setPageInfo(pageInfo);
        enterpriseKbVo.setSelectedKbs(selectedKbs);
        return enterpriseKbVo;
    }

    /**
     * 查询技能
     *
     * @param skillResourceQo 查询对象
     * @return List
     */
    public List<SpaceResourceVo> listSkills(SkillResourceQo skillResourceQo) {
        AuthContextBo authContextBo = resourceAuthContextService.getAuthContextBo();

        List<Long> resourceIds = authContextBo.getAuthResourceIds(ResourceBizType.AGENT.getCode(),
            ResourceBizType.TOOLKIT.getCode(), ResourceBizType.TOOL.getCode(), ResourceBizType.MCP_TOOL.getCode(),
            ResourceBizType.MCP.getCode());
        if (ListUtil.isEmpty(resourceIds)) {
            return Collections.emptyList();
        }

        skillResourceQo.setResourceIds(resourceIds);
        return spaceDirService.listSkills(skillResourceQo);
    }

    /**
     * 查询收藏夹资源
     *
     * @param collectResourceQo 查询
     * @return ResponseUtil
     */
    public List<SpaceResourceVo> listCollectResource(CollectResourceQo collectResourceQo) {
        collectResourceQo.setCreateBy(CurrentUserHolder.getCurrentUserId());
        return spaceDirService.listCollectResource(collectResourceQo);
    }

    /**
     * 搜问导入文件
     *
     * @param files 导入文件
     * @param sessionId 会话标识
     */
    public ImportFilesVo importFiles(MultipartFile[] files, Long sessionId, Long agentId) {

        // 如果没有会话，创建一个
        if (sessionId == null) {
            String name = spaceDirService.getNameByDirType(SpaceDirType.DIR_TYPE_IMPORT);
            sessionId = this.createSession(name + ":" + DateUtils.getFormatedDate(new Date()), agentId);
        }

        // 没有导入目录空间，创建一个
        SpaceDir spaceDir = spaceDirService.findOrCreateSpaceDir(sessionId, SpaceDirType.DIR_TYPE_IMPORT);

        List<Files> importResults = new ArrayList<>();

        for (MultipartFile multipartFile : files) {

            Files byaiFiles = this.uploadImportFiles(multipartFile, sessionId);

            // 记录上传结果
            importResults.add(byaiFiles);

            // 关联资源
            SpaceDirRel spaceDirRel = new SpaceDirRel();
            spaceDirRel.setDirRelId(sequenceService.nextVal());
            spaceDirRel.setDirId(spaceDir.getDirId());
            spaceDirRel.setDataType(SpaceDataType.DATA_TYPE_FILE);
            spaceDirRel.setDataId(byaiFiles.getFileId());
            spaceDriRelService.save(spaceDirRel);
        }

        // 导入结果
        ImportFilesVo importFilesVo = new ImportFilesVo();
        importFilesVo.setSessionId(sessionId);
        importFilesVo.setImportResults(importResults);
        return importFilesVo;
    }

    /**
     * 构建上传文件信息
     * 
     * @param multipartFile 文件信息
     * @param sessionId 会话标识
     * @return Files
     */
    private Files uploadImportFiles(MultipartFile multipartFile, Long sessionId) {

        Long fileId = sequenceService.nextVal();
        FileStorageContext fileStorageContext = FileStorageContext.searchImport(sessionId, fileId);
        FileMetadata fileMetadata = fileIngressService.uploadFile(multipartFile, fileStorageContext);

        Files byaiFiles = new Files();
        byaiFiles.setFileId(fileId);
        byaiFiles.setChatId(sessionId);
        byaiFiles.setFileName(fileMetadata.getFileName());
        byaiFiles.setConvertFileName(fileMetadata.getFileName());
        byaiFiles.setFileUrl(fileMetadata.getFileUrl());
        byaiFiles.setFileMd5(fileMetadata.getFileMd5());
        byaiFiles.setFileType(fileMetadata.getFileType());
        byaiFiles.setCreateBy(CurrentUserHolder.getCurrentUserId());
        byaiFiles.setCompleteTime(new Date());
        byaiFiles.setFileSystemType(fileMetadata.getStorageType());
        byaiFiles.setContentType(fileMetadata.getContentType());
        byaiFiles.setLength(fileMetadata.getFileSize());
        byaiFiles.setFileStatus(FileStatus.STATUS_00A);
        fileService.save(byaiFiles);

        return byaiFiles;
    }

    /**
     * 创建会话
     * 
     * @param sessionName 会话名称
     * @return Long
     */
    private Long createSession(String sessionName, Long agentId) {
        ByaiSession byaiSession = new ByaiSession();
        byaiSession.setSessionId(sequenceService.nextVal());
        byaiSession.setParentSessionId(-1L);
        byaiSession.setCreateTime(new Date());
        byaiSession.setSessionName(sessionName);
        byaiSession.setSessionType(SessionType.H_S_A.getCode());
        byaiSession.setObjectId(agentId);
        byaiSession.setObjectType(ConversationObjectType.DIGITAL_EMPLOYEES);
        byaiSession.setCreatorId(CurrentUserHolder.getCurrentUserId());
        byaiSession.setEnterpriseId(CurrentUserHolder.getEnterpriseId());
        sessionService.save(byaiSession);
        return byaiSession.getSessionId();
    }

    /**
     * 用户选择导入企业知识库或者个人知识库
     * 
     * @param selectedDatasetDto 选择对象
     */
    public ImportSelectedDatasetVo importSelectedDataset(SelectedDatasetDto selectedDatasetDto) {

        // 如果没有会话，创建一个
        Long sessionId = selectedDatasetDto.getSessionId();
        Long agentId = selectedDatasetDto.getAgentId();
        String dirType = selectedDatasetDto.getDirType();
        if (sessionId == null) {
            String name = spaceDirService.getNameByDirType(dirType);
            sessionId = this.createSession(name + ":" + DateUtils.getFormatedDate(new Date()), agentId);
        }

        // 没有企业知识库目录，创建一个
        SpaceDir spaceDir = spaceDirService.findOrCreateSpaceDir(sessionId, dirType);

        Long dirId = spaceDir.getDirId();
        List<SpaceDirRel> spaceDirRelList = spaceDriRelService.findByDirId(dirId, SpaceDataType.DATA_TYPE_RESOURCE);

        Map<Long, SpaceDirRel> spaceDirRelMap = new HashMap<>();
        for (SpaceDirRel spaceDirRel : spaceDirRelList) {
            spaceDirRelMap.put(spaceDirRel.getDataId(), spaceDirRel);
        }

        List<Long> resourceIds = selectedDatasetDto.getResourceIds();
        for (Long resourceId : resourceIds) {
            // 和页面选择的进行对比
            SpaceDirRel spaceDirRel = spaceDirRelMap.remove(resourceId);
            if (spaceDirRel == null) {
                spaceDirRel = new SpaceDirRel();
                spaceDirRel.setDirRelId(sequenceService.nextVal());
                spaceDirRel.setDirId(dirId);
                spaceDirRel.setDataId(resourceId);
                spaceDirRel.setDataType(SpaceDataType.DATA_TYPE_RESOURCE);
                spaceDriRelService.save(spaceDirRel);
            }
        }

        // 删除本次用户不选择的
        for (SpaceDirRel spaceDirRel : spaceDirRelMap.values()) {
            spaceDriRelService.removeById(spaceDirRel.getDirRelId());
        }

        ImportSelectedDatasetVo importSelectedDatasetVo = new ImportSelectedDatasetVo();
        importSelectedDatasetVo.setSessionId(sessionId);
        return importSelectedDatasetVo;
    }

    /**
     * 选择资源
     *
     * @param selectedDto 资源对象
     */
    public SelectedVo selectedResource(SelectedDto selectedDto) {

        Long sessionId = selectedDto.getSessionId();
        String dirType = selectedDto.getDirType();
        Long agentId = selectedDto.getAgentId();

        // 如果没有，创建session
        if (sessionId == null) {
            String name = spaceDirService.getNameByDirType(dirType);
            sessionId = this.createSession(name + ":" + DateUtils.getFormatedDate(new Date()), agentId);
        }

        // 没有企业知识库目录，创建一个
        SpaceDir spaceDir = spaceDirService.findOrCreateSpaceDir(sessionId, dirType);

        // 批量操作
        List<SpaceDataDto> spaceDataList = selectedDto.getSpaceDataList();
        for (SpaceDataDto spaceDataDto : spaceDataList) {
            String dataType = spaceDataDto.getDataType();
            Long dataId = spaceDataDto.getDataId();

            // 检查关联关系是否已经存在，不存在添加
            long count = spaceDriRelService.countSpaceDirRel(spaceDir.getDirId(), dataType, dataId);
            if (count <= 0) {
                SpaceDirRel spaceDirRel = new SpaceDirRel();
                spaceDirRel.setDirRelId(sequenceService.nextVal());
                spaceDirRel.setDirId(spaceDir.getDirId());
                spaceDirRel.setDataType(dataType);
                spaceDirRel.setDataId(dataId);
                spaceDriRelService.save(spaceDirRel);
            }
        }

        SelectedVo selectedVo = new SelectedVo();
        selectedVo.setSessionId(sessionId);
        return selectedVo;
    }

    /**
     * 取消资源选择
     *
     * @param selectedDto 选择对象
     */
    public SelectedVo unSelectedResource(SelectedDto selectedDto) {
        Long sessionId = selectedDto.getSessionId();
        String dirType = selectedDto.getDirType();
        Long agentId = selectedDto.getAgentId();

        // 如果没有，创建session
        if (sessionId == null) {
            String name = spaceDirService.getNameByDirType(dirType);
            sessionId = this.createSession(name + "取消选择:" + DateUtils.getFormatedDate(new Date()), agentId);
        }

        // 没有企业知识库目录，创建一个
        SpaceDir spaceDir = spaceDirService.findOrCreateSpaceDir(sessionId, dirType);

        // 称除关联关系
        List<SpaceDataDto> spaceDataList = selectedDto.getSpaceDataList();
        for (SpaceDataDto spaceDataDto : spaceDataList) {
            spaceDriRelService.remove(spaceDir.getDirId(), spaceDataDto.getDataType(), spaceDataDto.getDataId());
        }

        SelectedVo selectedVo = new SelectedVo();
        selectedVo.setSessionId(sessionId);
        return selectedVo;
    }
}
