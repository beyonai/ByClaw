package com.iwhalecloud.byai.state.domain.file.service;

import com.iwhalecloud.byai.manager.entity.file.Files;
import com.iwhalecloud.byai.manager.mapper.file.FilesMapper;
import com.iwhalecloud.byai.common.feign.request.knowledge.OpenFileDownloadDTO;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.common.feign.response.ManagerResponse;
import feign.Response;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;
import org.springframework.web.multipart.MultipartFile;
import java.util.List;
import java.util.Map;

/**
 * @author he.duming
 * @date 2026-01-03 22:27:15
 * @description TODO
 */
@Service
public class FileService {

    @Autowired
    private FilesMapper filesMapper;

    /**
     * 保存文件
     *
     * @param files 文件信息
     */
    public void save(Files files) {
        filesMapper.insert(files);
    }

    /**
     * 把门户对象对象转成成KnowledgeResponse返回
     *
     * @param resultUtil 结果对象
     * @param <T> 泛型类型
     * @return KnowledgeResponse
     */
    private <T> KnowledgeResponse<T> converToKnowledgeResponse(ManagerResponse<T> resultUtil) {
        KnowledgeResponse<T> knowledgeResponse = new KnowledgeResponse<>();
        knowledgeResponse.setResultCode(KnowledgeResponse.RESPONSE_SUCCESS);
        knowledgeResponse.setResultMsg(resultUtil.getMsg());
        knowledgeResponse.setResultObject(resultUtil.getData());

        return knowledgeResponse;
    }

    /**
     * API-01 - 上传文件 上传一个或多个文件到指定会话，支持为每个文件附加多个标签
     *
     * @param files 上传的文件数据
     * @param tags 文件标签，JSON格式的字符串数组
     * @param chatId 会话ID
     * @param projectId 项目ID
     * @param isTemporary 是否为临时文档
     * @return KnowledgeResponse
     */
    public KnowledgeResponse<Map<String, Object>> uploadFiles(MultipartFile[] files, List<String> tags, Long chatId,
        Long projectId, Boolean isTemporary) {
        return null;
    }

    /**
     * API-03 - 按标签获取文件 在指定会话下，根据标签查询匹配的文件
     *
     * @param request 包含chatId、tags、matchMode的请求参数
     * @return KnowledgeResponse
     */
    public KnowledgeResponse<Map<String, Object>> searchFilesByTags(Map<String, Object> request) {
        return null;
    }

    /**
     * API-04 - 下载文件 下载指定文件的原始内容
     *
     * @param openFileDownload 文件ID
     * @return 文件流
     */
    public Response downloadFiles(OpenFileDownloadDTO openFileDownload) {
        return null;
    }

    /**
     * API-07 - 批量添加标签 批量为多个文件添加标签
     *
     * @param request 批量标签添加请求，包含文件ID和标签信息
     * @return KnowledgeResponse
     */
    public KnowledgeResponse<List<Map<String, Object>>> addFileTagsBatch(Map<String, Object> request) {
        return null;
    }

}
