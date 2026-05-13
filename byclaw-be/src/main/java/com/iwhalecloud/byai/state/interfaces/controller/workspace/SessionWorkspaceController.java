package com.iwhalecloud.byai.state.interfaces.controller.workspace;

import com.iwhalecloud.byai.manager.dto.workspace.SaveWorkspaceToShowcaseBatchRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceBatchCreateRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceCreateRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceDeleteRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceListRequest;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceResponse;
import com.iwhalecloud.byai.manager.dto.workspace.SessionWorkspaceUpdateNameRequest;
import com.iwhalecloud.byai.manager.entity.workspace.ByaiSessionWorkspace;
import com.iwhalecloud.byai.state.domain.workspace.service.SessionWorkspaceService;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import java.util.List;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 会话工作区控制器
 * 提供会话工作区新增与列表查询接口
 *
 * @author system
 */
@Slf4j
@Validated
@RestController
@RequestMapping("/workspace")
@Tag(name = "会话工作区", description = "会话工作区管理接口")
public class SessionWorkspaceController {

    @Autowired
    private SessionWorkspaceService sessionWorkspaceService;


    /**
     * 新增会话工作区
     *
     * @param request 创建请求
     * @return 主键 id
     */
    @PostMapping("/create")
    @Operation(summary = "新增会话工作区", description = "新增一条会话工作区记录")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "创建成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Long> create(@RequestBody @Valid SessionWorkspaceCreateRequest request) {
        Long id = sessionWorkspaceService.create(request);
        return ResponseUtil.successResponse(id);
    }

    /**
     * 批量新增会话工作区
     * sessionId、relCount 公用，fileList 中每条文件项（name、fileId、fileUrl、icon）各存一条记录
     *
     * @param request 批量创建请求
     * @return 新增记录的主键 id 列表
     */
    @PostMapping("/createBatch")
    @Operation(summary = "批量新增会话工作区", description = "一次写入多条工作区记录，sessionId与relCount公用，文件信息以列表传入")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "创建成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<List<ByaiSessionWorkspace>> createBatch(@RequestBody @Valid SessionWorkspaceBatchCreateRequest request) {
        return ResponseUtil.successResponse(sessionWorkspaceService.createBatch(request));

    }



    /**
     * 批量将会话工作区文件保存到成果空间
     * 根据工作区 id 列表依次反查并写入成果空间，返回对应的成果空间主键 id 列表（顺序与请求一致）
     *
     * @param request 含 workspaceIds（会话工作区主键列表）
     * @return 成果空间主键 id 列表
     */
    @PostMapping("/saveToShowcaseBatch")
    @Operation(summary = "批量工作区文件保存到成果空间", description = "根据工作区id列表依次反查文件信息并写入成果空间，类型按文件后缀归类")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "保存成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<List<Long>> saveToShowcaseBatch(@RequestBody @Valid SaveWorkspaceToShowcaseBatchRequest request) {
        List<Long> showcaseIds = sessionWorkspaceService.saveWorkspaceFilesToShowcaseBatch(request.getWorkspaceIds());
        return ResponseUtil.successResponse(showcaseIds);
    }

    /**
     * 按会话 id 查询工作区列表
     *
     * @param request 列表查询请求（含 sessionId）
     * @return 工作区列表
     */
    @PostMapping("/list")
    @Operation(summary = "会话工作区列表", description = "按会话 id 查询工作区列表")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<List<SessionWorkspaceResponse>> list(@RequestBody @Valid SessionWorkspaceListRequest request) {
        List<SessionWorkspaceResponse> list = sessionWorkspaceService.listBySessionId(request);
        return ResponseUtil.successResponse(list);
    }

    /**
     * 根据主键删除会话工作区记录
     *
     * @param id 工作区记录主键
     * @return 操作结果
     */
    @PostMapping("/delete")
    @Operation(summary = "删除会话工作区", description = "根据主键删除一条会话工作区记录")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "删除成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Void> delete(@RequestBody @Valid SessionWorkspaceDeleteRequest request) {
        sessionWorkspaceService.deleteById(request.getId());
        return ResponseUtil.successResponse();
    }

    /**
     * 修改会话工作区名称
     *
     * @param request 修改名称请求（含 id、name）
     * @return 操作结果
     */
    @PostMapping("/updateName")
    @Operation(summary = "修改会话工作区名称", description = "根据主键修改会话工作区的文件名称")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "修改成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Void> updateName(@RequestBody @Valid SessionWorkspaceUpdateNameRequest request) {
        sessionWorkspaceService.updateName(request.getId(), request.getName());
        return ResponseUtil.successResponse();
    }
}
