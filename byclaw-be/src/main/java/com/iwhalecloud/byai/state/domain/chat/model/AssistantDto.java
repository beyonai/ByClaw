package com.iwhalecloud.byai.state.domain.chat.model;

import java.io.Serializable;
import java.util.List;

import com.iwhalecloud.byai.common.cache.ShareBfmUser;
import com.iwhalecloud.byai.common.feign.request.manager.Dataset;

import lombok.Data;

@Data
public class AssistantDto implements Serializable {

    ShareBfmUser userInfo;

    List<Dataset> datasetList;

    private Long assistant_id;

    private String assistant_name;

    private String assistant_intro;
}
