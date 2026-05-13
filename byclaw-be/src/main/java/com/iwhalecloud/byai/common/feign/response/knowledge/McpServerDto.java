package com.iwhalecloud.byai.common.feign.response.knowledge;

import java.util.Map;
import java.util.Objects;

import com.iwhalecloud.byai.common.feign.request.conversation.McpServer;
import lombok.Getter;
import lombok.Setter;

/**
 * @author zzh
 */
@Getter
@Setter
public class McpServerDto extends McpServer {

    /**
     * 请求头 Map
     */
    private Map<String, Object> headers;

    @Override
    public boolean equals(Object o) {
        if (this == o) {
            return true;
        }
        if (o == null || getClass() != o.getClass()) {
            return false;
        }
        if (!super.equals(o)) {
            return false;
        }

        McpServerDto that = (McpServerDto) o;

        return Objects.equals(headers, that.headers);
    }

    @Override
    public int hashCode() {
        int result = super.hashCode();
        result = 31 * result + (headers != null ? headers.hashCode() : 0);
        return result;
    }
}
