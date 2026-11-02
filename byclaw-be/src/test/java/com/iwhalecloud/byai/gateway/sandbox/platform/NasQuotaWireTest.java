package com.iwhalecloud.byai.gateway.sandbox.platform;
import com.iwhalecloud.byai.state.common.exception.NasQuotaExceededException;
import java.util.Map;
import org.junit.jupiter.api.Test;
import static org.assertj.core.api.Assertions.*;
class NasQuotaWireTest {
 @Test void structuredQuotaSurvivesAndUnrelatedErrorsAreNotReclassified() {
  Map<String,Object> details=Map.of("errorType","NAS_QUOTA_EXCEEDED","quotaBytes",10737418240L,"usedBytes",11811160064L,"exceededBytes",1073741824L,"poolId","private");
  NasQuotaExceededException error=NasQuotaExceededException.from(Map.of("code",-1,"data",details));
  assertThat(error).isNotNull();assertThat(error.details()).containsEntry("quotaBytes",10737418240L).doesNotContainKey("poolId");
  assertThat(NasQuotaExceededException.from(Map.of("msg","NAS_QUOTA_EXCEEDED"))).isNull();
 }
 @Test void http507AndBothLocalesKeepTheTypedPayload() {
  var http=org.mockito.Mockito.mock(feign.FeignException.class);
  org.mockito.Mockito.when(http.status()).thenReturn(507);
  org.mockito.Mockito.when(http.contentUTF8()).thenReturn("{\"code\":-1,\"data\":{\"errorType\":\"NAS_QUOTA_EXCEEDED\",\"quotaBytes\":1024}}");
  try {
   org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.US);
   assertThat(NasQuotaExceededException.from(http).getMessage()).contains("storage");
   org.springframework.context.i18n.LocaleContextHolder.setLocale(java.util.Locale.SIMPLIFIED_CHINESE);
   assertThat(NasQuotaExceededException.from(http).getMessage()).contains("网盘");
   assertThat(NasQuotaExceededException.from(http).details()).containsEntry("quotaBytes",1024L);
  } finally {org.springframework.context.i18n.LocaleContextHolder.resetLocaleContext();}
 }

}
