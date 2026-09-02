package com.cloudwa.control.logging;

import com.cloudwa.control.config.WaControlProperties;
import com.cloudwa.control.domain.AccountCreateRequest;
import com.fasterxml.jackson.databind.ObjectMapper;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.Signature;
import org.aspectj.lang.reflect.MethodSignature;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.extension.ExtendWith;
import org.mockito.Mockito;
import org.springframework.boot.test.system.CapturedOutput;
import org.springframework.boot.test.system.OutputCaptureExtension;
import org.springframework.mock.web.MockHttpServletRequest;
import org.springframework.web.bind.annotation.PathVariable;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.bind.annotation.RequestHeader;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;

import java.lang.reflect.Method;
import java.time.Duration;
import java.util.Map;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.when;

@ExtendWith(OutputCaptureExtension.class)
class RequestLoggingAspectTest {
  @Test
  void logsMethodUriDurationAndJsonBodyForControllerRequests(CapturedOutput output) throws Throwable {
    WaControlProperties properties = new WaControlProperties(
      new WaControlProperties.State("runtime/control-center.json"),
      new WaControlProperties.Evolution("http://127.0.0.1:8080", "key", "http://host.docker.internal:4100", "secret", Duration.ofSeconds(3), Duration.ofSeconds(15), true),
      new WaControlProperties.Media(
        new WaControlProperties.S3("http://127.0.0.1:9000", "us-east-1", "wa-control-media", "access", "secret"),
        new WaControlProperties.Upload(10, 20, 5)
      ),
      new WaControlProperties.Logging(new WaControlProperties.RequestLog(true, true, 512))
    );
    RequestLoggingAspect aspect = new RequestLoggingAspect(new ObjectMapper(), properties);
    ProceedingJoinPoint joinPoint = Mockito.mock(ProceedingJoinPoint.class);
    Signature signature = Mockito.mock(Signature.class);
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/accounts");
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

    when(signature.toShortString()).thenReturn("ControlApiController.createAccount(..)");
    when(joinPoint.getSignature()).thenReturn(signature);
    when(joinPoint.getArgs()).thenReturn(new Object[] { new AccountCreateRequest("日志账号") });
    when(joinPoint.proceed()).thenReturn("ok");

    try {
      aspect.logControllerRequest(joinPoint);
    } finally {
      RequestContextHolder.resetRequestAttributes();
    }

    assertThat(output).contains("POST /api/accounts");
    assertThat(output).contains("durationMs=");
    assertThat(output).contains("\"name\":\"日志账号\"");
  }

  @Test
  void logsOnlyRequestBodyParameterWhenControllerHasPathAndHeaderArgs(CapturedOutput output) throws Throwable {
    RequestLoggingAspect aspect = new RequestLoggingAspect(new ObjectMapper(), properties(true, 512));
    ProceedingJoinPoint joinPoint = Mockito.mock(ProceedingJoinPoint.class);
    MethodSignature signature = Mockito.mock(MethodSignature.class);
    Method method = TestController.class.getDeclaredMethod("webhook", String.class, String.class, Map.class);
    MockHttpServletRequest request = new MockHttpServletRequest("POST", "/api/webhooks/evolution/account-1");
    RequestContextHolder.setRequestAttributes(new ServletRequestAttributes(request));

    when(signature.toShortString()).thenReturn("TestController.webhook(..)");
    when(signature.getMethod()).thenReturn(method);
    when(joinPoint.getSignature()).thenReturn(signature);
    when(joinPoint.getArgs()).thenReturn(new Object[] {
      "account-1",
      "local-mvp-webhook-secret",
      Map.of("event", "messages.update", "instance", "wa_account1")
    });
    when(joinPoint.proceed()).thenReturn("ok");

    try {
      aspect.logControllerRequest(joinPoint);
    } finally {
      RequestContextHolder.resetRequestAttributes();
    }

    assertThat(output).contains("POST /api/webhooks/evolution/account-1");
    assertThat(output).contains("body={")
      .contains("\"instance\":\"wa_account1\"")
      .contains("\"event\":\"messages.update\"")
      .doesNotContain("local-mvp-webhook-secret")
      .doesNotContain("body=[\"account-1\"");
  }

  private static WaControlProperties properties(boolean includeBody, int maxBodyLength) {
    return new WaControlProperties(
      new WaControlProperties.State("runtime/control-center.json"),
      new WaControlProperties.Evolution("http://127.0.0.1:8080", "key", "http://host.docker.internal:4100", "secret", Duration.ofSeconds(3), Duration.ofSeconds(15), true),
      new WaControlProperties.Media(
        new WaControlProperties.S3("http://127.0.0.1:9000", "us-east-1", "wa-control-media", "access", "secret"),
        new WaControlProperties.Upload(10, 20, 5)
      ),
      new WaControlProperties.Logging(new WaControlProperties.RequestLog(true, includeBody, maxBodyLength))
    );
  }

  static class TestController {
    void webhook(@PathVariable String accountId, @RequestHeader String secret, @RequestBody Map<String, Object> payload) {}
  }
}
