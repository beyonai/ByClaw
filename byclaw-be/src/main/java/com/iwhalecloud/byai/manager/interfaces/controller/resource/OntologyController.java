package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.iwhalecloud.byai.manager.application.service.ontology.OntologyApplicationService;
import com.iwhalecloud.byai.manager.domain.resource.service.OntologyOpenService;
import com.iwhalecloud.byai.manager.domain.resource.service.OntologyService;
import com.iwhalecloud.byai.manager.dto.ontology.ObjectDto;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyActionSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyAttributeSaveRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyCreateRelationRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyCreateRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyDeleteRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyDetailResponse;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyQueryByIdRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyQueryRequest;
import com.iwhalecloud.byai.manager.dto.ontology.OntologyUpdateRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.Api;
import io.swagger.annotations.ApiOperation;
import jakarta.validation.Valid;
import java.util.List;
import java.util.Map;
import org.springframework.beans.BeanUtils;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 对象管理控制器
 */
@Api(tags = "对象管理")
@RestController
@RequestMapping("/ontology")
@Validated
public class OntologyController {

    @Autowired
    private OntologyService ontologyService;

    @Autowired
    private OntologyApplicationService ontologyApplicationService;

    @Autowired
    private OntologyOpenService ontologyOpenService;

    /**
     * 创建对象
     *
     * @param request 创建请求
     * @return ResponseUtil
     */
    @ApiOperation("创建对象")
    @PostMapping("/create")
    @ManageLogAnnotation(name = "创建对象", description = "创建新的对象")
    public ResponseUtil<SsResource> createOntology(@Valid @RequestBody OntologyCreateRequest request) {
        SsResource resource = ontologyService.createOntology(request);
        return ResponseUtil.successRes(resource);
    }

    /**
     * 创建对象关联关系
     * 如果relId为空，则先创建新对象；然后插入双向关联关系
     *
     * @param request 创建关联请求
     * @return ResponseUtil
     */
    @ApiOperation("创建对象关联关系")
    @PostMapping("/createRelation")
    @ManageLogAnnotation(name = "创建对象关联关系", description = "创建对象之间的关联关系，如果relId为空则先创建新对象")
    public ResponseUtil<SsResource> createOntologyRelation(@Valid @RequestBody OntologyCreateRelationRequest request) {
        SsResource resource = ontologyService.createOntologyRelation(request);
        return ResponseUtil.successRes(resource);
    }



    /**
     * 更新对象
     *
     * @param request 更新请求
     * @return ResponseUtil
     */
    @ApiOperation("更新对象")
    @PostMapping("/update")
    @ManageLogAnnotation(name = "更新对象", description = "更新对象信息")
    public ResponseUtil<SsResource> updateOntology(@Valid @RequestBody OntologyUpdateRequest request) {
        SsResource resource = ontologyService.updateOntology(request);
        return ResponseUtil.successRes(resource);
    }

    /**
     * 删除对象
     *
     * @param request 删除请求，包含资源ID
     * @return ResponseUtil
     */
    @ApiOperation("删除对象")
    @PostMapping("/delete")
    @ManageLogAnnotation(name = "删除对象", description = "删除对象")
    public ResponseUtil<Boolean> deleteOntology(@Valid @RequestBody OntologyDeleteRequest request) {
        boolean result = ontologyService.deleteOntology(request.getResourceId());
        return ResponseUtil.successRes(result);
    }


    /**
     * 删除对象
     *
     * @param request 删除请求，包含资源ID
     * @return ResponseUtil
     */
    @ApiOperation("删除对象")
    @PostMapping("/deleteRelation")
    @ManageLogAnnotation(name = "删除对象", description = "删除对象")
    public ResponseUtil<Boolean> deleteRelation(@Valid @RequestBody OntologyDeleteRequest request) {
        ontologyService.deleteRelation(request);
        return ResponseUtil.successResponse();
    }


    /**
     * 保存对象的动作相关内容
     * 包括：动作和动作属性
     *
     * @param request 动作保存请求
     * @return ResponseUtil
     */
    @ApiOperation("保存对象动作")
    @PostMapping("/saveBatch")
    @ManageLogAnnotation(name = "保存对象动作", description = "保存对象的动作相关内容，包括动作和动作属性")
    public ResponseUtil<Map<String, Object>> saveOntologyInfos(@Valid @RequestBody OntologyActionSaveRequest request) {
        if (request.getSourceType() != null  && 4 == request.getSourceType()) {
            OntologyAttributeSaveRequest ontologyAttributeSaveRequest = new OntologyAttributeSaveRequest();
            BeanUtils.copyProperties(request, ontologyAttributeSaveRequest);
            return ResponseUtil.successRes(ontologyApplicationService.saveAttributes(ontologyAttributeSaveRequest));
        }
        return ResponseUtil.successRes(ontologyService.saveOntologyInfos(request));
    }


    /**
     * 保存对象的动作相关内容
     * 包括：动作和动作属性
     *
     * @param request 动作保存请求
     * @return ResponseUtil
     */
    @ApiOperation("保存对象动作")
    @PostMapping("/saveOntologyFull")
    @ManageLogAnnotation(name = "保存对象动作", description = "保存对象的动作相关内容，包括动作和动作属性")
    public ResponseUtil<Map<String, Object>> saveBatchForOther(@Valid @RequestBody OntologyActionSaveRequest request) {

        return ResponseUtil.successRes(ontologyOpenService.saveBatchOpen(request));
    }


    @ApiOperation("保存对象动作")
    @PostMapping("/saveOntologyActions")
    @ManageLogAnnotation(name = "保存对象动作", description = "保存对象的动作相关内容，包括动作和动作属性")
    public ResponseUtil<Map<String, Object>> saveOntologyActions(@Valid @RequestBody OntologyActionSaveRequest request) {

        return ResponseUtil.successRes(ontologyApplicationService.saveOntologyActionInfos(request));
    }

    @ApiOperation("保存对象动作")
    @PostMapping("/saveAttributes")
    @ManageLogAnnotation(name = "保存对象动作", description = "保存对象的动作相关内容，包括动作和动作属性")
    public ResponseUtil<Map<String, Object>> saveAttributes(@Valid @RequestBody OntologyAttributeSaveRequest request) {

        return ResponseUtil.successRes(ontologyApplicationService.saveAttributes(request));
    }

    @PostMapping("/queryRelObjects")
    @ManageLogAnnotation(name = "查询当前对象及其关联的对象", description = "一次性保存对象的所有数据，包括对象信息、属性、函数、动作、关联对象")
    public ResponseUtil<List<ObjectDto>> queryRelObjects(@RequestBody OntologyQueryRequest request) {

        return ResponseUtil.successRes(ontologyApplicationService.queryRelObjects(request));
    }

    /**
     * 根据对象resourceId查询对象详情
     * 包括：对象基本信息、对象属性、动作列表及动作属性
     *
     * @param request 查询请求，包含对象resourceId
     * @return ResponseUtil
     */
    @ApiOperation("查询对象详情")
    @PostMapping("/queryDetail")
    @ManageLogAnnotation(name = "查询对象详情", description = "根据对象resourceId查询对象详情，包括对象基本信息、对象属性、动作列表及动作属性")
    public ResponseUtil<OntologyDetailResponse> queryOntologyDetail(@Valid @RequestBody OntologyQueryByIdRequest request) {
        return ResponseUtil.successRes(ontologyService.queryOntologyDetail(request.getResourceId()));
    }


}
