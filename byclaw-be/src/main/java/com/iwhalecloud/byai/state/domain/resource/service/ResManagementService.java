package com.iwhalecloud.byai.state.domain.resource.service;

import com.baomidou.mybatisplus.extension.plugins.pagination.Page;
import com.iwhalecloud.byai.manager.dto.resource.ResourcePageDto;
import com.iwhalecloud.byai.manager.dto.resource.ResourceQueryRequest;
import com.iwhalecloud.byai.manager.entity.resource.SsResource;
import com.iwhalecloud.byai.manager.mapper.resource.SsResourceMapper;
import com.iwhalecloud.byai.common.feign.response.KnowledgeResponse;
import com.iwhalecloud.byai.manager.mapper.auth.ResourceAuthContextMapper;
import com.iwhalecloud.byai.common.feign.request.manager.Dataset;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Service;

@Service
public class ResManagementService {

    public static final Logger LOGGER = LoggerFactory.getLogger(ResManagementService.class);

    @Autowired
    private ResourceAuthContextMapper resourceAuthContextMapper;

    @Autowired
    private SsResourceMapper resourceMapper;

    /**
     * 构建知识库
     *
     * @param resourceIds 资源标识
     * @return List
     */
    public List<Dataset> getDatasetList(List<Long> resourceIds) {
        List<Dataset> datasets = new ArrayList<>();
        List<SsResource> resources = resourceAuthContextMapper.getResourceByIds(resourceIds);
        for (SsResource resource : resources) {
            Dataset dataset = new Dataset();
            dataset.setDatasetId(resource.getResourceSourcePkId());
            dataset.setDatasetName(resource.getResourceName());
            dataset.setDatasetDesc(resource.getResourceDesc());
            dataset.setResourceBizType(resource.getResourceBizType());
            dataset.setResourceId(resource.getResourceId());
            dataset.setDatasetCode(resource.getResourceCode());
            datasets.add(dataset);
        }
        return datasets;
    }

    public KnowledgeResponse getResourceListByPage(ResourceQueryRequest request) {
        Page<ResourcePageDto> page = new Page<>(request.getPageNum(), request.getPageSize());
        List<ResourcePageDto> resourceListByPage = resourceMapper.getResourceListByPage(page, request);

        Map<String, Object> result = new HashMap<>();
        result.put("list", resourceListByPage);
        result.put("total", page.getTotal());
        result.put("pageNum", page.getCurrent());
        result.put("pageSize", page.getSize());
        result.put("pages", page.getPages());

        return KnowledgeResponse.success(result);
    }
}
