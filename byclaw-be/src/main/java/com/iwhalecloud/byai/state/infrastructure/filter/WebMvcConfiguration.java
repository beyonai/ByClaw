package com.iwhalecloud.byai.state.infrastructure.filter;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

import org.springframework.cloud.client.loadbalancer.LoadBalanced;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.http.converter.ByteArrayHttpMessageConverter;
import org.springframework.http.converter.FormHttpMessageConverter;
import org.springframework.http.converter.HttpMessageConverter;
import org.springframework.http.converter.StringHttpMessageConverter;
import org.springframework.http.converter.json.Jackson2ObjectMapperBuilder;
import org.springframework.http.client.SimpleClientHttpRequestFactory;
import org.springframework.web.client.RestTemplate;
import org.springframework.web.multipart.support.StandardServletMultipartResolver;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import com.alibaba.fastjson.parser.Feature;
import com.alibaba.fastjson.serializer.SerializeConfig;
import com.alibaba.fastjson.serializer.SerializerFeature;
import com.alibaba.fastjson.serializer.ToStringSerializer;
import com.alibaba.fastjson.support.config.FastJsonConfig;
import com.alibaba.fastjson.support.spring.FastJsonHttpMessageConverter;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.fasterxml.jackson.databind.module.SimpleModule;

/**
 * Spring MVC 配置类，用于配置Web相关组件和功能。
 * <p>
 * 主要功能包括：
 * <ul>
 * <li>配置HTTP消息转换器（包括FastJson和Jackson）</li>
 * <li>配置文件上传解析器</li>
 * <li>配置拦截器（包括访问令牌验证和签名防重放）</li>
 * <li>配置静态资源处理</li>
 * <li>配置RestTemplate客户端</li>
 * </ul>
 *
 * @author ztesoft
 * @version 1.0
 */
@Configuration
public class WebMvcConfiguration implements WebMvcConfigurer {

    /**
     * 配置字节数组消息转换器，用于处理二进制数据。
     *
     * @return ByteArrayHttpMessageConverter 实例
     */
    @Bean
    public ByteArrayHttpMessageConverter byteArrayHttpMessageConverter() {
        return new ByteArrayHttpMessageConverter();
    }

    /**
     * 配置字符串消息转换器，用于处理文本数据。 支持 TEXT_PLAIN 媒体类型。
     * <p>显式使用 UTF-8，避免 StringHttpMessageConverter 默认 ISO-8859-1 导致中文乱码（含 SSE 透传场景）。
     *
     * @return StringHttpMessageConverter 实例
     */
    @Bean
    public StringHttpMessageConverter stringHttpMessageConverter() {
        StringHttpMessageConverter stringHttpMessageConverter =
            new StringHttpMessageConverter(StandardCharsets.UTF_8);
        List<MediaType> supportedMediaTypes = new ArrayList<MediaType>();
        supportedMediaTypes.add(MediaType.TEXT_PLAIN);
        stringHttpMessageConverter.setSupportedMediaTypes(supportedMediaTypes);
        stringHttpMessageConverter.setWriteAcceptCharset(false);
        return stringHttpMessageConverter;
    }

    /**
     * 配置Jackson ObjectMapper，用于处理JSON序列化和反序列化。 主要配置包括：
     * <ul>
     * <li>将Long类型转换为String，避免前端精度丢失</li>
     * <li>将Integer类型转换为String，保持数据类型一致性</li>
     * </ul>
     *
     * @param builder Jackson2ObjectMapperBuilder实例
     * @return 配置好的ObjectMapper实例
     */
    @Bean
    public ObjectMapper jacksonObjectMapper(Jackson2ObjectMapperBuilder builder) {
        ObjectMapper objectMapper = builder.createXmlMapper(false).build();

        // 全局配置将Long类型转换为String
        SimpleModule module = new SimpleModule();
        module.addSerializer(Long.class, com.fasterxml.jackson.databind.ser.std.ToStringSerializer.instance);
        module.addSerializer(Long.TYPE, com.fasterxml.jackson.databind.ser.std.ToStringSerializer.instance);
        module.addSerializer(Integer.class, com.fasterxml.jackson.databind.ser.std.ToStringSerializer.instance);
        module.addSerializer(Integer.TYPE, com.fasterxml.jackson.databind.ser.std.ToStringSerializer.instance);
        objectMapper.registerModule(module);

        return objectMapper;
    }

    /**
     * 配置表单数据消息转换器，用于处理表单提交数据。
     *
     * @return FormHttpMessageConverter 实例
     */
    @Bean
    public FormHttpMessageConverter formHttpMessageConverter() {
        return new FormHttpMessageConverter();
    }

    /**
     * 配置文件上传解析器。 Spring Boot 3.x 中使用 StandardServletMultipartResolver 替代 CommonsMultipartResolver。
     *
     * @return StandardServletMultipartResolver 实例
     */
    @Bean(name = "multipartResolver")
    public StandardServletMultipartResolver multipartResolver() {
        return new StandardServletMultipartResolver();
    }

    /**
     * 配置访问令牌验证拦截器。
     *
     * @return AccessTokenVerifyInterceptor 实例
     */
    @Bean
    public AccessTokenVerifyInterceptor tokenVerifyInterceptor() {
        return new AccessTokenVerifyInterceptor();
    }

    /**
     * 添加拦截器配置。 配置令牌验证和签名防重放拦截器，应用于所有路径。
     *
     * @param registry InterceptorRegistry实例
     */
    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(tokenVerifyInterceptor()).addPathPatterns("/**");
    }

    /**
     * 配置静态资源处理器。 包括：
     * <ul>
     * <li>静态资源文件</li>
     * <li>Swagger UI 资源</li>
     * <li>Webjars 资源</li>
     * </ul>
     *
     * @param registry ResourceHandlerRegistry实例
     */
    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        registry.addResourceHandler("/**").addResourceLocations("classpath:/static/");
        registry.addResourceHandler("swagger-ui.html").addResourceLocations("classpath:/META-INF/resources/");
        registry.addResourceHandler("/webjars/**").addResourceLocations("classpath:/META-INF/resources/webjars/");
    }

    /**
     * 配置负载均衡的RestTemplate客户端。 使用@LoadBalanced注解支持服务发现。
     *
     * @return RestTemplate实例
     */
    @Bean
    @LoadBalanced
    RestTemplate restTemplate() {
        return new RestTemplate();
    }

    /**
     * 成果空间文件下载专用 RestTemplate，避免负载均衡导致的 IP 直连失败。
     * <p>该客户端设置了连接和读取超时，防止远端资源不可用时阻塞业务线程。</p>
     *
     * @return RestTemplate实例
     */
    @Bean(name = "showcaseFileRestTemplate")
    RestTemplate showcaseFileRestTemplate() {
        SimpleClientHttpRequestFactory factory = new SimpleClientHttpRequestFactory();
        // 连接和读取超时均设置为 5 秒，避免网络异常时长时间挂起
        factory.setConnectTimeout(5000);
        factory.setReadTimeout(5000);
        return new RestTemplate(factory);
    }

    /**
     * 扩展消息转换器配置。 添加FastJson消息转换器，主要用于处理com.ztesoft包下的对象。 配置包括：
     * <ul>
     * <li>禁用循环引用检测</li>
     * <li>数值类型转String</li>
     * <li>输出空值字段</li>
     * <li>非字符串键值转字符串</li>
     * </ul>
     *
     * @param converters 消息转换器列表
     */
    @Override
    public void extendMessageConverters(List<HttpMessageConverter<?>> converters) {
        FastJsonHttpMessageConverter fastJsonConverter = new FastJsonHttpMessageConverter() {
            @Override
            protected boolean supports(Class<?> clazz) {
                // 只处理你的业务对象，不处理 springdoc-openapi 的对象
                String packageName = clazz.getPackageName();
                // 只处理 com.ztesoft 下的对象
                return packageName.startsWith("com.ztesoft");
            }
        };
        // 配置 fastJsonConverter 的相关属性（如你原来的代码）
        FastJsonConfig fastJsonConfig = new FastJsonConfig();
        fastJsonConfig.setFeatures(Feature.DisableCircularReferenceDetect
        // Feature.DisableSpecialKeyDetect,
        // Feature.IgnoreAutoType,
        // Feature.SupportArrayToBean
        );
        SerializeConfig serializeConfig = new SerializeConfig();
        // 配置数值类型转String
        serializeConfig.put(Long.class, ToStringSerializer.instance);
        serializeConfig.put(Long.TYPE, ToStringSerializer.instance);
        serializeConfig.put(Integer.class, ToStringSerializer.instance);
        serializeConfig.put(Integer.TYPE, ToStringSerializer.instance);

        fastJsonConfig.setSerializeConfig(serializeConfig);

        // 其他FastJson配置
        fastJsonConfig.setFeatures(Feature.DisableCircularReferenceDetect);
        fastJsonConfig.setSerializerFeatures(SerializerFeature.DisableCircularReferenceDetect,
            SerializerFeature.WriteMapNullValue, SerializerFeature.WriteNonStringKeyAsString);
        fastJsonConverter.setFastJsonConfig(fastJsonConfig);
        fastJsonConverter.setSupportedMediaTypes(List.of(MediaType.APPLICATION_JSON, MediaType.TEXT_PLAIN));
        // 添加到 converters 列表最前面
        converters.add(0, fastJsonConverter);
    }

}
