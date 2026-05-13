package com.iwhalecloud.byai.state.interfaces.controller.searchask;

import com.iwhalecloud.byai.manager.dto.searchask.SelectedDatasetDto;
import com.iwhalecloud.byai.manager.dto.searchask.SelectedDto;
import com.iwhalecloud.byai.manager.qo.searchask.CollectResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.EnterpriseKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.PersonalKbQo;
import com.iwhalecloud.byai.manager.qo.searchask.SkillResourceQo;
import com.iwhalecloud.byai.manager.qo.searchask.SpaceResourceQo;
import com.iwhalecloud.byai.manager.vo.searchask.EnterpriseKbVo;
import com.iwhalecloud.byai.manager.vo.searchask.ImportFilesVo;
import com.iwhalecloud.byai.manager.vo.searchask.ImportSelectedDatasetVo;
import com.iwhalecloud.byai.manager.vo.searchask.PersonalKbVo;
import com.iwhalecloud.byai.manager.vo.searchask.SelectedVo;
import com.iwhalecloud.byai.manager.vo.searchask.SpaceResourceVo;
import com.iwhalecloud.byai.state.application.service.searchask.SpaceDriApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.List;

/**
 * @author he.duming
 * @date 2026-03-04 09:30:42
 * @description 目录空间
 */
@RestController
@RequestMapping("/spaceDir")
public class SpaceDriController {

    @Autowired
    private SpaceDriApplicationService spaceDriApplicationService;

    /**
     * 查询导入对象
     * 
     * @param importResourceQo 查询
     * @return ResponseUtil
     */
    @PostMapping("/listImportResource")
    public ResponseUtil<List<SpaceResourceVo>> listImportResource(@RequestBody SpaceResourceQo importResourceQo) {
        List<SpaceResourceVo> list = spaceDriApplicationService.listImportResource(importResourceQo);
        return ResponseUtil.successResponse(list);
    }

    /**
     * 搜问导入文件
     * 
     * @param files 导入文件
     * @param sessionId 会话标识
     * @return ResponseUtil
     */
    @PostMapping("/importFiles")
    public ResponseUtil<ImportFilesVo> importFiles(@RequestBody @RequestParam("files") MultipartFile[] files,
                                               @RequestParam(name = "sessionId", required = false) Long sessionId,
                                               @RequestParam(name = "agentId", required = false) Long agentId) {
        ImportFilesVo importFilesVo = spaceDriApplicationService.importFiles(files, sessionId, agentId);
        return ResponseUtil.successResponse(importFilesVo);
    }

    /**
     * 个人知识库
     * 
     * @param personalKbQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/listPersonalKb")
    public ResponseUtil<PersonalKbVo> listPersonalKb(@RequestBody PersonalKbQo personalKbQo) {
        PersonalKbVo personalKbVo = spaceDriApplicationService.listPersonalKb(personalKbQo);
        return ResponseUtil.successResponse(personalKbVo);
    }

    /**
     * 企业知识库
     * 
     * @param enterpriseKbQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/listEnterpriseKb")
    public ResponseUtil<EnterpriseKbVo> listEnterpriseKb(@RequestBody EnterpriseKbQo enterpriseKbQo) {
        EnterpriseKbVo enterpriseKbVo = spaceDriApplicationService.listEnterpriseKb(enterpriseKbQo);
        return ResponseUtil.successResponse(enterpriseKbVo);
    }

    /**
     * 查询收藏夹
     * 
     * @param collectResourceQo 查询对象
     * @return ResponseUtil
     */
    @PostMapping("/listCollectResource")
    public ResponseUtil<List<SpaceResourceVo>> listCollectResource(@RequestBody CollectResourceQo collectResourceQo) {
        List<SpaceResourceVo> list = spaceDriApplicationService.listCollectResource(collectResourceQo);
        return ResponseUtil.successResponse(list);
    }

    /**
     * 查询所有技能
     *
     * @param skillResourceQo 查询
     * @return ResponseUtil
     */
    @PostMapping("/listSkills")
    public ResponseUtil<List<SpaceResourceVo>> listSkills(@RequestBody SkillResourceQo skillResourceQo) {
        List<SpaceResourceVo> list = spaceDriApplicationService.listSkills(skillResourceQo);
        return ResponseUtil.successResponse(list);
    }

    /**
     * 导入选择知识库
     * 
     * @param selectedDatasetDto 知识库
     * @return ResponseUtil
     */
    @PostMapping("/importSelectedDataset")
    public ResponseUtil<?> importSelectedDataset(@RequestBody SelectedDatasetDto selectedDatasetDto) {
        ImportSelectedDatasetVo resultVo = spaceDriApplicationService.importSelectedDataset(selectedDatasetDto);
        return ResponseUtil.successResponse(resultVo);
    }

    /**
     * 选择资源
     * 
     * @param selectedDto 资源对象
     * @return ResponseUtil
     */
    @PostMapping("/selectedResource")
    public ResponseUtil<?> selectedResource(@RequestBody SelectedDto selectedDto) {
        SelectedVo selectedVo = spaceDriApplicationService.selectedResource(selectedDto);
        return ResponseUtil.successResponse(selectedVo);
    }

    /**
     * 取消资源选择
     * 
     * @param selectedDto 选择对象
     * @return ResponseUtil
     */
    @PostMapping("/unSelectedResource")
    public ResponseUtil<SelectedVo> unSelectedResource(@RequestBody SelectedDto selectedDto) {
        SelectedVo selectedVo = spaceDriApplicationService.unSelectedResource(selectedDto);
        return ResponseUtil.successResponse(selectedVo);
    }

}
