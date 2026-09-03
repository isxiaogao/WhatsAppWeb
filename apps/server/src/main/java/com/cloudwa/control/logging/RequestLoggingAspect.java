package com.cloudwa.control.logging;

import com.cloudwa.control.config.WaControlProperties;
import com.fasterxml.jackson.databind.ObjectMapper;
import jakarta.servlet.ServletRequest;
import jakarta.servlet.ServletResponse;
import org.aspectj.lang.ProceedingJoinPoint;
import org.aspectj.lang.annotation.Around;
import org.aspectj.lang.annotation.Aspect;
import org.aspectj.lang.reflect.MethodSignature;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;
import org.springframework.web.bind.annotation.RequestBody;
import org.springframework.web.context.request.RequestContextHolder;
import org.springframework.web.context.request.ServletRequestAttributes;
import org.springframework.web.multipart.MultipartFile;

import jakarta.servlet.http.HttpServletRequest;
import java.lang.annotation.Annotation;
import java.util.Arrays;
import java.util.Optional;

@Aspect
@Component
public class RequestLoggingAspect {
    private static final Logger log = LoggerFactory.getLogger(RequestLoggingAspect.class);
    private final ObjectMapper mapper;
    private final WaControlProperties.RequestLog properties;

    public RequestLoggingAspect(ObjectMapper mapper, WaControlProperties properties) {
        this.mapper = mapper;
        this.properties = properties.logging().request();
    }

    @Around("within(@org.springframework.web.bind.annotation.RestController *)")
    public Object logControllerRequest(ProceedingJoinPoint joinPoint) throws Throwable {
        if (!properties.enabled()) return joinPoint.proceed();
        long startedAt = System.nanoTime();
        HttpServletRequest request = currentRequest();
        String method = request == null ? "UNKNOWN" : request.getMethod();
        String uri = request == null ? joinPoint.getSignature().toShortString() : request.getRequestURI();
        try {
            Object result = joinPoint.proceed();
            log.info("{} {} durationMs={} body={}", method, uri, elapsedMillis(startedAt), requestBody(joinPoint));
            return result;
        } catch (Throwable error) {
            log.warn("{} {} durationMs={} error={} body={}", method, uri, elapsedMillis(startedAt), error.toString(), requestBody(joinPoint));
            throw error;
        }
    }

    private String requestBody(ProceedingJoinPoint joinPoint) {
        if (!properties.includeBody()) return "<disabled>";
        Optional<Object> annotatedBody = requestBodyArgument(joinPoint);
        if (annotatedBody.isPresent()) return serialize(annotatedBody.get());
        Object[] serializableArgs = Arrays.stream(joinPoint.getArgs())
                .filter(arg -> arg != null)
                .filter(arg -> !(arg instanceof MultipartFile))
                .filter(arg -> !(arg instanceof ServletRequest))
                .filter(arg -> !(arg instanceof ServletResponse))
                .toArray();
        if (serializableArgs.length == 0) return "<empty>";
        return serialize(serializableArgs.length == 1 ? serializableArgs[0] : serializableArgs);
    }

    private Optional<Object> requestBodyArgument(ProceedingJoinPoint joinPoint) {
        if (!(joinPoint.getSignature() instanceof MethodSignature signature)) return Optional.empty();
        Annotation[][] annotations = signature.getMethod().getParameterAnnotations();
        Object[] args = joinPoint.getArgs();
        for (int i = 0; i < annotations.length && i < args.length; i++) {
            if (args[i] == null) continue;
            if (Arrays.stream(annotations[i]).anyMatch(annotation -> annotation.annotationType() == RequestBody.class)) {
                return Optional.of(args[i]);
            }
        }
        return Optional.empty();
    }

    private String serialize(Object value) {
        try {
            String body = mapper.writeValueAsString(value);
            return truncate(body);
        } catch (Exception error) {
            return "<unserializable:" + error.getClass().getSimpleName() + ">";
        }
    }

    private String truncate(String value) {
        int maxLength = Math.max(0, properties.maxBodyLength());
        if (value.length() <= maxLength) return value;
        return value.substring(0, maxLength) + "...";
    }

    private static HttpServletRequest currentRequest() {
        if (RequestContextHolder.getRequestAttributes() instanceof ServletRequestAttributes attributes) {
            return attributes.getRequest();
        }
        return null;
    }

    private static long elapsedMillis(long startedAt) {
        return (System.nanoTime() - startedAt) / 1_000_000;
    }
}
