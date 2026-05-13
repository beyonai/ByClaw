package com.iwhalecloud.byai.state.interfaces.controller.searchask;

import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.state.application.service.searchask.WebSearchArchiveApplicationService;
import com.iwhalecloud.byai.state.domain.searchask.dto.ArchiveSelectedDocDTO;
import com.iwhalecloud.byai.state.domain.searchask.dto.SessionArchiveQueryDTO;
import com.iwhalecloud.byai.state.domain.searchask.dto.WebSearchDocDTO;
import com.iwhalecloud.byai.state.domain.searchask.vo.ArchiveSelectedDocVO;
import com.iwhalecloud.byai.state.domain.searchask.vo.SessionSelectDocVO;
import com.iwhalecloud.byai.state.domain.searchask.vo.WebSearchQueryVO;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;


/**
 * 联网搜索归档 控制器
 * <p>
 * 接收前端 query，调用 DocChain 搜索，爬取 URL 转 Markdown 上传并归档，返回 request_id 与 doc_list。
 * </p>
 *
 * @author system
 */
@RestController
@RequestMapping("/web-search")
@Tag(name = "联网搜索归档", description = "联网搜索文档归档接口")
@Slf4j
public class WebSearchArchiveController {

    @Autowired
    private WebSearchArchiveApplicationService webSearchArchiveApplicationService;

    /**
     * 联网搜索：根据 query 调用 DocChain 搜索，写入请求表并返回请求记录与文本列表；前端可勾选后再调 archive-selected 归档选中项。
     *
     * @param request 归档请求（query 必填，sessionId、topicId、size 可选）
     * @return 统一响应，data 含 requestId、textList（DocChain 文本列表）
     */
    @PostMapping("/query")
    @Operation(summary = "联网搜索", description = "根据 query 执行联网搜索，返回 requestId 与文本列表，供前端勾选后调用选中归档")
    @ManageLogAnnotation(name = "会话API调用", description = "联网搜索")
    public ResponseUtil<WebSearchQueryVO> query(@RequestBody @Valid WebSearchDocDTO request) {
        log.debug("/web-search/query request query length={}",
            request.getQuery() != null ? request.getQuery().length() : 0);
        WebSearchQueryVO response = webSearchArchiveApplicationService.query(request);
        return ResponseUtil.successResponse(response);
    }

    /**
     * 导入文档：对指定 requestId 下选中的 textList 条目执行爬取→MD→上传→落库，返回本次归档的 docList（含 fileUrl）。
     *
     * @param request 选中归档请求（requestId、dirId、sessionId、textList 必填）
     * @return 统一响应，data 含 requestId、query、docList
     */
    @PostMapping("/archive-selected")
    @Operation(summary = "导入文档", description = "对 query 返回的 textList 中选中的条目进行爬取转 MD 并归档")
    @ManageLogAnnotation(name = "会话API调用", description = "联网搜索导入文档")
    public ResponseUtil<ArchiveSelectedDocVO> archiveSelected(@RequestBody @Valid ArchiveSelectedDocDTO request) {
        log.debug("/web-search/archive-selected requestId={}, textListSize={}", request.getRequestId(),
            request.getTextList() != null ? request.getTextList().size() : 0);
        ArchiveSelectedDocVO response = webSearchArchiveApplicationService.archiveSelected(request);
        return ResponseUtil.successResponse(response);
    }

    /**
     * 按 sessionId 反查：返回该会话下所有 request 的 query 与文档归档列表，及每条文档关联的 byai_files 文件信息（fileName、fileUrl、contentType）。
     *
     * @param request 请求体，sessionId 必填
     * @return 统一响应，data 含 sessionId、requestList（每项含 requestId、query、createTime、docList，docList 含归档字段及文件信息）
     */
    @PostMapping("/session-archive")
    @Operation(summary = "按会话反查归档", description = "根据 sessionId 查询该会话下所有归档请求的 query 与文档列表及文件信息")
    @ManageLogAnnotation(name = "会话API调用", description = "按会话反查联网搜索归档")
    public ResponseUtil<SessionSelectDocVO> sessionArchive(@RequestBody @Valid SessionArchiveQueryDTO request) {
        log.debug("/web-search/session-archive sessionId={}", request.getSessionId());
        SessionSelectDocVO response = webSearchArchiveApplicationService.listBySessionId(request.getSessionId());
        return ResponseUtil.successResponse(response);
    }

}
