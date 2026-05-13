package com.iwhalecloud.byai.manager.interfaces.controller.resource;

import com.fasterxml.jackson.annotation.JsonProperty;
import com.github.pagehelper.PageHelper;
import com.github.pagehelper.PageInfo;
import com.iwhalecloud.byai.manager.domain.resource.service.SsResourceCatalogService;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceCatalogTreeVO;
import com.iwhalecloud.byai.manager.entity.resource.SsResourceCatalog;
import com.iwhalecloud.byai.manager.qo.organization.CatalogQo;
import com.iwhalecloud.byai.manager.qo.resource.CatalogDto;
import com.iwhalecloud.byai.manager.qo.resource.QueryResourceCatalogTreeRequest;
import com.iwhalecloud.byai.common.annotation.ManageLogAnnotation;
import com.iwhalecloud.byai.manager.interfaces.response.ResponseUtil;
import io.swagger.annotations.ApiOperation;
import jakarta.validation.Valid;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.validation.annotation.Validated;
import org.springframework.web.bind.annotation.PostMapping;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * 资源目录管理控制器
 */

@RestController
@RequestMapping("/catalog")
@Validated
public class SsResourceCatalogController {

    @Autowired
    private SsResourceCatalogService ssResourceCatalogService;

    /**
     * 创建目录
     *
     * @param catalog 目录信息
     * @return ResponseUtil
     */
    @PostMapping("/create")
    @ManageLogAnnotation(name = "创建目录", description = "创建资源目录")
    public ResponseUtil<SsResourceCatalog> createCatalog(@Valid @RequestBody CatalogDto catalog) {
        return ResponseUtil.successRes(ssResourceCatalogService.createCatalog(catalog));
    }

    /**
     * 更新目录
     *
     * @param catalog 目录信息
     * @return ResponseUtil
     */
    @PostMapping("/update")
    @ManageLogAnnotation(name = "更新目录", description = "更新资源目录信息")
    public ResponseUtil<SsResourceCatalog> updateCatalog(@Valid @RequestBody CatalogDto catalog) {
        SsResourceCatalog result = ssResourceCatalogService.updateCatalog(catalog);
        return ResponseUtil.successRes(result);
    }

    /**
     * 删除目录
     *
     * @param request 删除请求，包含目录ID
     * @return ResponseUtil
     */
    @PostMapping("/delete")
    @ManageLogAnnotation(name = "删除目录", description = "删除资源目录")
    public ResponseUtil<Boolean> deleteCatalog(@RequestBody DeleteCatalogRequest request) {

        if (request == null || request.getCatalogId() == null) {
            return ResponseUtil.failRes("目录ID不能为空");
        }
        boolean result = ssResourceCatalogService.deleteCatalog(request.getCatalogId());
        return ResponseUtil.successRes(result);

    }

    /**
     * 根据ID查询目录
     *
     * @param request 查询请求，包含目录ID
     * @return ResponseUtil
     */
    @PostMapping("/queryById")
    public ResponseUtil<CatalogDto> queryCatalogById(@RequestBody QueryCatalogRequest request) {
        if (request == null || request.getCatalogId() == null) {
            return ResponseUtil.failRes("目录ID不能为空");
        }
        CatalogDto result = ssResourceCatalogService.queryCatalogById(request.getCatalogId());
        if (result == null) {
            return ResponseUtil.failRes("目录不存在");
        }
        return ResponseUtil.successRes(result);
    }

    /**
     * 查询目录列表
     *
     * @param catalogQo 查询条件
     * @return ResponseUtil
     */
    @PostMapping("/queryList")
    public ResponseUtil<List<SsResourceCatalog>> queryCatalogList(@RequestBody CatalogQo catalogQo) {
        List<SsResourceCatalog> result = ssResourceCatalogService.queryCatalogList(catalogQo);
        return ResponseUtil.successRes(result);
    }

    /**
     * 查询目录树
     *
     * @param catalogQo 查询条件
     * @return ResponseUtil
     */
    @ApiOperation("查询目录树")
    @PostMapping("/queryCatalogTree")
    @ManageLogAnnotation(name = "查询目录树", description = "查询资源目录树")
    public ResponseUtil<List<SsResourceCatalog>> queryCatalogTree(@RequestBody CatalogQo catalogQo) {
        List<SsResourceCatalog> result = ssResourceCatalogService.queryCatalogTree(catalogQo);
        return ResponseUtil.successRes(result);
    }

    /**
     * 根据父目录ID查询子目录列表
     *
     * @param request 查询请求，包含父目录ID
     * @return ResponseUtil
     */
    @ApiOperation("根据父目录ID查询子目录列表")
    @PostMapping("/queryChildren")
    public ResponseUtil<List<SsResourceCatalog>> queryChildrenByParentId(@RequestBody QueryChildrenRequest request) {
        if (request == null || request.getPCatalogId() == null) {
            return ResponseUtil.failRes("父目录ID不能为空");
        }
        List<SsResourceCatalog> result = ssResourceCatalogService.queryChildrenByParentId(request.getPCatalogId());
        return ResponseUtil.successRes(result);
    }

    /**
     * 根据父目录ID查询子目录列表
     *
     * @param request 查询请求，包含父目录ID
     * @return ResponseUtil
     */
    @ApiOperation("根据领域/要素过滤资源")
    @PostMapping("/queryResourceListByCatalogId")
    public ResponseUtil<Map<String, Object>> queryResourceListByCatalogId(@RequestBody CatalogDto request) {
        PageHelper.startPage(request.getPageIndex(), request.getPageSize());
        List<ResourceCatalogDto> result = ssResourceCatalogService.queryResourceListByCatalogId(request);
        PageInfo<ResourceCatalogDto> pageInfo = new PageInfo<>(result);
        return ResponseUtil.successRes(buildPageRes(pageInfo));
    }

    /**
     * 查询资源目录关联树 关联查询 ss_resource 和 ss_resource_catalog 表
     *
     * @param request 查询请求，包含 catalogType（可选）
     * @return ResponseUtil
     */
    @ApiOperation("查询资源目录关联树")
    @PostMapping("/queryResourceCatalogTree")
    @ManageLogAnnotation(name = "查询资源目录关联树", description = "查询资源目录关联树")
    public ResponseUtil<List<ResourceCatalogTreeVO>> queryResourceCatalogTree(
        @Valid @RequestBody QueryResourceCatalogTreeRequest request) {
        Integer catalogType = request != null ? request.getCatalogType() : null;
        List<ResourceCatalogTreeVO> result = ssResourceCatalogService.queryResourceCatalogTree(catalogType);
        return ResponseUtil.successRes(result);
    }

    private Map<String, Object> buildPageRes(PageInfo<ResourceCatalogDto> pageInfo) {
        Map<String, Object> res = new HashMap<>();
        res.put("total", pageInfo.getTotal());
        res.put("rows", pageInfo.getList());
        res.put("page", pageInfo.getPageNum());
        res.put("pageSize", pageInfo.getPageSize());
        res.put("totalPage", pageInfo.getPages());
        return res;
    }

    /**
     * 删除目录请求对象
     */
    public static class DeleteCatalogRequest {
        private Long catalogId;

        public Long getCatalogId() {
            return catalogId;
        }

        public void setCatalogId(Long catalogId) {
            this.catalogId = catalogId;
        }
    }

    /**
     * 查询目录请求对象
     */
    public static class QueryCatalogRequest {
        private Long catalogId;

        public Long getCatalogId() {
            return catalogId;
        }

        public void setCatalogId(Long catalogId) {
            this.catalogId = catalogId;
        }
    }

    /**
     * 查询子目录请求对象
     */
    public static class QueryChildrenRequest {
        @JsonProperty(value = "pCatalogId")
        private Long pCatalogId;

        public Long getPCatalogId() {
            return pCatalogId;
        }

        public void setPCatalogId(Long pCatalogId) {
            this.pCatalogId = pCatalogId;
        }
    }
}
