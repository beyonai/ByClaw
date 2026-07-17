package com.iwhalecloud.byai.state.interfaces.controller.recorder;

import com.jayway.jsonpath.JsonPath;
import org.springframework.test.web.servlet.MvcResult;

final class JsonTestValue {

    private JsonTestValue() {
    }

    static String readString(MvcResult result, String path) throws Exception {
        return JsonPath.read(result.getResponse().getContentAsString(), path);
    }
}
