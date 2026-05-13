package com.iwhalecloud.byai.state.interfaces.controller.showcase;

import com.alibaba.fastjson.JSONObject;
import com.iwhalecloud.byai.common.message.entity.ByaiMessageHotDto;
import com.iwhalecloud.byai.state.application.service.message.MessageService;
import com.iwhalecloud.byai.state.domain.showcase.service.ShowcaseService;
import com.iwhalecloud.byai.manager.vo.showcase.ByaiShowcaseVo;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseCancelRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseCreateRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseQueryRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseDetailResponse;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseUpdateRequest;
import com.iwhalecloud.byai.state.interfaces.controller.showcase.dto.ShowcaseRenameRequest;
import com.iwhalecloud.byai.state.common.dto.FileUploadDto;
import com.iwhalecloud.byai.state.common.dto.MessageQo;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import java.util.List;
import java.util.Map;
import com.iwhalecloud.byai.common.page.PageInfo;
import io.swagger.v3.oas.annotations.Operation;
import io.swagger.v3.oas.annotations.media.Content;
import io.swagger.v3.oas.annotations.media.Schema;
import io.swagger.v3.oas.annotations.responses.ApiResponse;
import io.swagger.v3.oas.annotations.responses.ApiResponses;
import io.swagger.v3.oas.annotations.tags.Tag;
import jakarta.validation.Valid;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.PutMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 成果空间控制器
 * <p>
 * 提供成果空间的增删改查接口，仅返回必要字段，避免敏感数据泄露。
 * </p>
 *
 * @author system
 * @date 2025-11-10
 */
@Slf4j
@Validated
@RestController
@RequestMapping("/showcase")
@Tag(name = "成果空间", description = "成果空间管理接口")
public class ShowcaseController {

    private final ShowcaseService showcaseService;

    @Autowired
    private MessageService messageService;

    public ShowcaseController(ShowcaseService showcaseService) {
        this.showcaseService = showcaseService;
    }

    /**
     * 新增成果空间
     *
     * @param request 创建请求
     * @return 主键ID
     */
    @PostMapping("/create")
    @Operation(summary = "新增成果空间", description = "用于新增成果空间数据，支持多种类型的成果内容")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "创建成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Long> createShowcase(@RequestBody @Valid ShowcaseCreateRequest request) {
        log.info("收到新增成果空间请求: {}", JSONObject.toJSONString(request));
        Long id = showcaseService.createShowcase(request);
        return ResponseUtil.successResponse(id);
    }

    /**
     * 更新成果空间
     *
     * @param request 更新请求
     * @return 是否更新成功
     */
    @PutMapping("/update")
    @Operation(summary = "更新成果空间", description = "根据主键更新成果空间内容")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "更新成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Boolean> updateShowcase(@RequestBody @Valid ShowcaseUpdateRequest request) {
        log.info("收到更新成果空间请求: {}", JSONObject.toJSONString(request));
        boolean updateResult = showcaseService.updateShowcase(request);
        return ResponseUtil.successResponse(updateResult);
    }

    /**
     * 重命名成果空间
     *
     * @param request 重命名请求
     * @return 是否更新成功
     */
    @PostMapping("/rename")
    @Operation(summary = "重命名成果空间", description = "根据主键更新成果空间名称")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "重命名成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Boolean> renameShowcase(@RequestBody @Valid ShowcaseRenameRequest request) {
        log.info("收到重命名成果空间请求 id={} name={}", request.getId(), request.getName());
        boolean updateResult = showcaseService.renameShowcase(request.getId(), request.getName());
        return ResponseUtil.successResponse(updateResult);
    }

    /**
     * 删除成果空间
     * 
     * @return 是否删除成功
     */
    @PostMapping("/delete")
    @Operation(summary = "删除成果空间", description = "根据主键删除成果空间数据")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "删除成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Boolean> deleteShowcase(@RequestBody ShowcaseUpdateRequest request) {
        log.info("收到删除成果空间请求，主键ID: {}", request.getId());
        boolean deleteResult = showcaseService.deleteShowcase(request.getId());
        return ResponseUtil.successResponse(deleteResult);
    }

    /**
     * 取消成果收藏
     *
     * @param request 取消请求
     * @return 是否成功
     */
    @PostMapping("/cancelCollect")
    @Operation(summary = "取消成果收藏", description = "根据条件将成果状态置为无效")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "操作成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Boolean> cancelCollect(@RequestBody @Valid ShowcaseCancelRequest request) {
        log.info("收到取消收藏请求: {}", JSONObject.toJSONString(request));
        boolean success = showcaseService.cancelCollect(request);
        return ResponseUtil.successResponse(success);
    }

    /**
     * 查询成果空间详情
     *
     * @param id 主键ID
     * @return 成果空间详情
     */
    @GetMapping("/{id}")
    @Operation(summary = "查询成果空间详情", description = "根据主键查询成果空间详情")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<ShowcaseDetailResponse> getShowcaseDetail(@PathVariable("id") Long id) {
        try {
            ShowcaseDetailResponse detail = ShowcaseDetailResponse.from(showcaseService.getShowcaseDetail(id));
            return ResponseUtil.successResponse(detail);
        }
        catch (IllegalArgumentException e) {
            return ResponseUtil.fail(e.getMessage());
        }
    }

    /**
     * 查询成果空间列表
     *
     * @param request 查询条件
     * @return 成果空间集合
     */
    @PostMapping("/list")
    @Operation(summary = "查询成果空间列表", description = "根据条件查询成果空间列表")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<PageInfo<ByaiShowcaseVo>> listShowcase(@RequestBody @Valid ShowcaseQueryRequest request) {
        PageInfo<ByaiShowcaseVo> showcasePage = showcaseService.queryShowcaseList(request.toQueryParam());
        return ResponseUtil.successResponse(showcasePage);
    }

    /**
     * 查询当前消息在会话中的位置
     *
     * @param messageQo 查询请求参数
     * @return ResponseUtil
     */
    @PostMapping("/messages/count")
    @Operation(summary = "查询当前消息在会话中的位置", description = "查询当前消息在会话中的位置")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "查询成功"),
        @ApiResponse(responseCode = "400", description = "参数错误"),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Object> getMessageCountAndPosition(@RequestBody MessageQo messageQo) {
        return ResponseUtil.successResponse(messageService.getMessageCountAndPosition(messageQo));
    }

    @PostMapping(path = "/saveToDoc")
    @Operation(summary = "保存成果空间文件到知识库", description = "保存成果空间文件到知识库", tags = "保存成果空间文件到知识库")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "预处理成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<Map<String, Object>> saveToDoc(@RequestBody FileUploadDto dto) {
        return ResponseUtil.successResponse(showcaseService.saveToDoc(dto));
    }

    @PostMapping(path = "/getChatHistory")
    @Operation(summary = "保存成果空间文件到知识库", description = "保存成果空间文件到知识库", tags = "保存成果空间文件到知识库")
    @ApiResponses({
        @ApiResponse(responseCode = "0", description = "预处理成功",
            content = @Content(mediaType = "application/json", schema = @Schema(implementation = ResponseUtil.class))),
        @ApiResponse(responseCode = "500", description = "服务器内部错误")
    })
    public ResponseUtil<List<ByaiMessageHotDto>> getChatHistory(@RequestBody ShowcaseQueryRequest qo) {
        return ResponseUtil.successResponse(showcaseService.getChatHistory(qo));
    }

}
