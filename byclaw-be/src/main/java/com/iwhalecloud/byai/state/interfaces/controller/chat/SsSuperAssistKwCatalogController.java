package com.iwhalecloud.byai.state.interfaces.controller.chat;

import com.iwhalecloud.byai.manager.dto.resource.UploadResult;
import com.iwhalecloud.byai.state.application.service.chat.SsSuperAssistKwCatalogApplicationService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.Parameter;
import io.swagger.v3.oas.annotations.tags.Tag;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;

/**
 * @author he.duming
 * @date 2025-04-22 00:50:38
 * @description 创建知识库，上传构建文档
 */

@RestController
@RequestMapping("/SsSuperAssistKwCatalogController")
@Tag(name = "知识库文档管理", description = "提供知识库文档的上传和构建功能")
public class SsSuperAssistKwCatalogController {

    @Autowired
    private SsSuperAssistKwCatalogApplicationService superAssistKwCatalogApplicationService;

    /**
     * 上传并构建文档
     * 
     * @param files 文件信息
     * @param sessionType 会话类型，固定会话只有CHAT_BI:鲸智-问数;WRITER:鲸智-慧笔;DIGI_HUM:鲸智-鲸灵;AGENT:普通数字员工
     * @param sessionId 会话信息
     * @return ResponseUtil
     */
    @Operation(summary = "上传并构建文档", description = "上传文件并构建知识库数据集")
    @PostMapping("/uploadFileAndRebuildDataset")
    public ResponseUtil<UploadResult> uploadFileAndRebuild(
        @Parameter(description = "要上传的文件列表", required = true) @RequestParam("files") MultipartFile[] files,
        @Parameter(description = "会话类型，可选值：CHAT_BI(鲸智-问数)、WRITER(鲸智-慧笔)、DIGI_HUM(鲸智-鲸灵)、AGENT(普通数字员工)",
            required = true) @RequestParam("sessionType") String sessionType,
        @Parameter(description = "会话ID，可选") @RequestParam(value = "sessionId", required = false) Long sessionId,
        @Parameter(description = "是否构建，可选") @RequestParam(value = "build", required = false) Boolean build,
        @Parameter(description = "数据员工ID，可选") @RequestParam(value = "agentId", required = false) Long agentId) {

        try {
            UploadResult uploadResult = superAssistKwCatalogApplicationService.uploadFileAndRebuild(files, sessionType,
                sessionId, build, agentId);
            return ResponseUtil.success(uploadResult);
        }
        catch (Exception e) {
            return ResponseUtil.fail(e.getMessage());
        }
    }

}
