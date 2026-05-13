package com.iwhalecloud.byai.manager.interfaces.controller.openapi;

import com.iwhalecloud.byai.manager.application.service.files.FilesApplicationService;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.util.ListUtil;
import com.iwhalecloud.byai.manager.dto.file.UploadFilesRespDto;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDelDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileMetaDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileQueryDTO;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileTagDTO;
import jakarta.servlet.http.HttpServletResponse;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.http.MediaType;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RequestMethod;
import org.springframework.web.bind.annotation.RequestParam;
import org.springframework.web.bind.annotation.RequestPart;
import org.springframework.web.bind.annotation.RestController;
import org.springframework.web.multipart.MultipartFile;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2025-08-07 21:53:36
 * @description 开放智能体文件上传
 */
@RestController
@RequestMapping("/open/api/v1")
public class OpenFileController {

    @Autowired
    private FilesApplicationService filesApplicationService;

    /**
     * API-01 - 上传文件 上传一个或多个文件到指定会话，支持为每个文件附加多个标）
     *
     * @param files 上传的文件数据
     * @param tags 文件标签，JSON格式的字符串数组
     * @param isTemporary 是否为临时文档
     * @return 统一响应
     */
    @RequestMapping(value = "/uploadFiles", method = RequestMethod.POST, produces = "application/json;charset=UTF-8",
        consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public ResponseUtil<Map<String, Object>> uploadFiles(@RequestPart("files") MultipartFile[] files,
        @RequestParam("tags") List<String> tags, @RequestParam("chatId") Long chatId,
        @RequestParam(value = "projectId", required = false) Long projectId,
        @RequestParam(value = "isTemporary", defaultValue = "true") Boolean isTemporary) {
        Map<String, Object> data = filesApplicationService.uploadFiles(files, tags, chatId, projectId, isTemporary);
        return ResponseUtil.successResponse("OK", data);
    }

    /**
     * API-03 - 按标签获取文档在指定会话下，根据标签查询匹配的文件
     *
     * @param openFileQueryDTO 包含chatId、tags、matchMode的请求参数
     * @return 统一响应
     */
    @RequestMapping(value = "/queryFiles", method = RequestMethod.POST, produces = "application/json;charset=UTF-8",
        consumes = "application/json;charset=UTF-8")
    @ManageLogAnnotation(name = "API文件管理", description = "在指定会话下，根据标签查询匹配的文件")
    public ResponseUtil<Map<String, Object>> queryFiles(@RequestBody OpenFileQueryDTO openFileQueryDTO) {
        if (openFileQueryDTO.getChatId() == null) {
            return ResponseUtil.fail("chatId不能为空");
        }
        String matchMode = openFileQueryDTO.getMatchMode();
        if (!"any".equalsIgnoreCase(matchMode) && !"all".equalsIgnoreCase(matchMode)) {
            return ResponseUtil.fail("参数异常");
        }
        Map<String, Object> data = filesApplicationService.queryFiles(openFileQueryDTO);
        return ResponseUtil.successResponse("OK", data);
    }

    /**
     * API-04 - 下载文件 下载指定文件的原始内容
     *
     * @param response 响应
     * @param fileId 文件标识
     */
    @RequestMapping(value = "/downloadFiles", method = RequestMethod.GET)
    @ManageLogAnnotation(name = "API文件管理", description = "下载文件")
    public void downloadFiles(HttpServletResponse response, @RequestParam("fileId") Long fileId) {
        filesApplicationService.downloadFiles(response, fileId);
    }

    /**
     * API-05 - 查看文件元信息查看指定文件的标签、状态、上传时间等元数据信息
     *
     * @param openFileMetaDTO 查询文件元数据
     * @return 统一响应
     */

    @RequestMapping(value = "/queryFileMeta", method = RequestMethod.POST, produces = "application/json;charset=UTF-8")
    @ManageLogAnnotation(name = "API文件管理", description = "查看文件元信息")
    public ResponseUtil<UploadFilesRespDto> queryFileMeta(@RequestBody OpenFileMetaDTO openFileMetaDTO) {
        UploadFilesRespDto uploadFilesRespDto = filesApplicationService.queryFileMeta(openFileMetaDTO);
        return ResponseUtil.successResponse("OK", uploadFilesRespDto);
    }

    /**
     * API-06 - 删除文件 通过optype=delete参数删除指定文件
     *
     * @param openFileDelDTO 文件ID
     * @return 统一响应
     */
    @RequestMapping(value = "/deleteFiles", method = RequestMethod.POST, produces = "application/json;charset=UTF-8")
    @ManageLogAnnotation(name = "API文件管理", description = "删除文件")
    public ResponseUtil<Map<String, Object>> deleteFiles(@RequestBody OpenFileDelDTO openFileDelDTO) {
        Map<String, Object> data = filesApplicationService.deleteFiles(openFileDelDTO);
        if (data == null) {
            return ResponseUtil.successResponse();
        }
        return ResponseUtil.success(data);
    }

    /**
     * API-07 - 批量添加标签 批量为多个文件添加标）
     *
     * @param openFileTagDTO 批量标签添加请求，包含文件ID和标签信息
     * @return 统一响应
     */
    @RequestMapping(value = "/addFileTags", method = RequestMethod.POST, produces = "application/json;charset=UTF-8",
        consumes = "application/json;charset=UTF-8")
    @ManageLogAnnotation(name = "API文件管理", description = "批量为多个文件添加标签")
    public ResponseUtil<List<UploadFilesRespDto>> addFileTags(@RequestBody OpenFileTagDTO openFileTagDTO) {
        if (ListUtil.isEmpty(openFileTagDTO.getFiles())) {
            return ResponseUtil.fail("添加标签数据为空!");
        }
        List<UploadFilesRespDto> data = filesApplicationService.addFileTags(openFileTagDTO);
        return ResponseUtil.success(data);
    }

    /**
     * API-08 - 批量删除标签 批量从多个文件中移除指定标签
     *
     * @param openFileTagDTO 批量标签删除请求，包含文件ID和标签信息
     * @return 统一响应
     */
    @RequestMapping(value = "/deleteFileTags", method = RequestMethod.POST, produces = "application/json;charset=UTF-8",
        consumes = "application/json;charset=UTF-8")
    @ManageLogAnnotation(name = "API文件管理", description = "批量从多个文件中移除指定标签")
    public ResponseUtil<List<UploadFilesRespDto>> deleteFileTags(@RequestBody OpenFileTagDTO openFileTagDTO) {
        if (ListUtil.isEmpty(openFileTagDTO.getFiles())) {
            return ResponseUtil.fail("删除标识数据为空!");
        }
        List<UploadFilesRespDto> data = filesApplicationService.deleteFileTags(openFileTagDTO);
        return ResponseUtil.success(data);
    }

}
