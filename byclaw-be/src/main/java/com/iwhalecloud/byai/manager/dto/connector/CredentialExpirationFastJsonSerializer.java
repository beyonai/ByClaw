package com.iwhalecloud.byai.manager.dto.connector;

import com.alibaba.fastjson.serializer.JSONSerializer;
import com.alibaba.fastjson.serializer.ObjectSerializer;

import java.io.IOException;
import java.lang.reflect.Type;
import java.time.ZoneOffset;
import java.time.format.DateTimeFormatter;
import java.util.Date;

/** FastJSON 凭证有效期序列化器，固定输出 GMT+8 ISO-8601 偏移时间。 */
public class CredentialExpirationFastJsonSerializer implements ObjectSerializer {

    private static final DateTimeFormatter FORMATTER = DateTimeFormatter
        .ofPattern("yyyy-MM-dd'T'HH:mm:ssXXX")
        .withZone(ZoneOffset.ofHours(8));

    @Override
    public void write(JSONSerializer serializer, Object object, Object fieldName, Type fieldType, int features)
        throws IOException {
        if (object == null) {
            serializer.writeNull();
            return;
        }
        serializer.write(FORMATTER.format(((Date) object).toInstant()));
    }
}
