package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.domain.resource.service.SsResExtDbDatasetService;
import com.iwhalecloud.byai.manager.dto.resource.DBDatasetQueryDto;
import com.iwhalecloud.byai.manager.dto.resource.DBDatasetSaveRequest;
import com.iwhalecloud.byai.manager.dto.resource.DatasetParamQueryResponse;
import com.iwhalecloud.byai.manager.dto.resource.DatasetParamSaveRequest;
import com.iwhalecloud.byai.manager.dto.resource.DatasetResponse;
import com.iwhalecloud.byai.manager.dto.resource.ResourceDatasetSaveDto;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.common.constants.resource.ResourceBizType;
import com.iwhalecloud.byai.common.i18n.I18nUtil;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import jakarta.validation.Valid;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;


/**
 * 数据集管理控制器
 * @author zzh
 */
@Api(tags = "数据集管理")
@RestController
@RequestMapping("/dataset")
@Validated
public class SsResourceDataSetController {

    @Autowired
    private SsResExtDbDatasetService ssResExtDbDatasetService;

    /**
     * 新增数据集
     */
    @ApiOperation("新增资源数据集")
    @PostMapping("/createResource")
    @ManageLogAnnotation(name = "数据集管理", description = "保存数据集配置")
    public ResponseUtil<?> insertDataset(@Valid @RequestBody ResourceDatasetSaveDto dto) {
        if (!ResourceBizType.DB_DATASET.getCode().equals(dto.getResourceBizType())) {
            return ResponseUtil.fail(I18nUtil.get("resource.biz.type.not.support", dto.getResourceBizType()));
        }
        return ResponseUtil.success(ssResExtDbDatasetService.createDBDataSetResource(dto));
    }

    /**
     * 保存数据集配置
     */
    @ApiOperation("保存数据集配置")
    @PostMapping("/save")
    @ManageLogAnnotation(name = "数据集管理", description = "保存数据集配置")
    public ResponseUtil<?> saveDataset(@Valid @RequestBody DBDatasetSaveRequest request) {
        ssResExtDbDatasetService.saveOrUpdate(request);
        return ResponseUtil.success("保存成功");
    }

    /**
     * 查询数据集配置
     */
    @ApiOperation("查询数据集配置")
    @PostMapping("/query")
    public ResponseUtil<?> queryDataset(@Valid @RequestBody DBDatasetQueryDto request) {
        DatasetResponse response = ssResExtDbDatasetService.queryDatasetResponse(request.getResourceId());
        return ResponseUtil.success(response);
    }

    /**
     * 保存数据集入参和出参
     */
    @ApiOperation("保存数据集入参和出参")
    @PostMapping("/saveParams")
    @ManageLogAnnotation(name = "数据集管理", description = "保存数据集入参和出参")
    public ResponseUtil<?> saveDatasetParams(@Valid @RequestBody DatasetParamSaveRequest request) {
        ssResExtDbDatasetService.saveDatasetParams(request);
        return ResponseUtil.success("保存成功");
    }

    /**
     * 查询数据集参数设置（用于前端展示和回显）
     */
    @ApiOperation("查询数据集参数设置")
    @PostMapping("/queryParams")
    public ResponseUtil<?> queryDatasetParams(@Valid @RequestBody DBDatasetQueryDto request) {
        DatasetParamQueryResponse response = ssResExtDbDatasetService.queryDatasetParams(request.getResourceId());
        return ResponseUtil.success(response);
    }

    /**
     * 删除资源数据集 (资源数据集删除、数据集配置删除、数据集入参和出参删除)
     */
    @ApiOperation("删除资源数据集")
    @PostMapping("/delete")
    @ManageLogAnnotation(name = "数据集管理", description = "删除资源数据集")
    public ResponseUtil<?> deleteDataset(@Valid @RequestBody DBDatasetQueryDto request) {
        ssResExtDbDatasetService.deleteDBDataSetResource(request.getResourceId());
        return ResponseUtil.success("删除成功");
    }

}
