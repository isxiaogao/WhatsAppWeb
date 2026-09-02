package com.cloudwa.control;

import com.cloudwa.control.config.WaControlProperties;
import com.cloudwa.control.domain.*;
import com.cloudwa.control.provider.ProviderHealth;
import com.cloudwa.control.storage.StoredMediaObject;
import org.springframework.http.*;
import org.springframework.web.bind.annotation.*;
import org.springframework.web.multipart.MultipartFile;
import org.springframework.web.servlet.mvc.method.annotation.SseEmitter;

import java.io.IOException;
import java.time.Instant;
import java.util.Map;

@RestController
@RequestMapping("/api")
public class ControlApiController {
    private final ControlCenterService service;
    private final WaControlProperties properties;

    public ControlApiController(ControlCenterService service, WaControlProperties properties) {
        this.service = service;
        this.properties = properties;
    }

    @GetMapping("/health")
    public Map<String, Object> health() {
        ProviderHealth provider = service.getProviderHealth();
        return Map.of("ok", provider.ok(), "service", "cloud-wa-control", "version", "0.1.0",
                "provider", provider, "time", Instant.now().toString());
    }

    @GetMapping("/accounts")
    public Map<String, Object> accounts() {
        return Map.of("items", service.listAccounts());
    }

    @PostMapping("/accounts")
    @ResponseStatus(HttpStatus.CREATED)
    public Account createAccount(@RequestBody AccountCreateRequest input) {
        return service.createAccount(input);
    }

    @PostMapping("/accounts/{accountId}/connect")
    public Account connect(@PathVariable String accountId) {
        return service.connectAccount(accountId);
    }

    @PostMapping("/accounts/{accountId}/disconnect")
    public Account disconnect(@PathVariable String accountId) {
        return service.disconnectAccount(accountId);
    }

    @DeleteMapping("/accounts/{accountId}")
    public Map<String, String> delete(@PathVariable String accountId) {
        return service.deleteAccount(accountId);
    }

    @GetMapping("/accounts/{accountId}/conversations")
    public Map<String, Object> conversations(@PathVariable String accountId) {
        return Map.of("items", service.listConversations(accountId));
    }

    @PostMapping("/accounts/{accountId}/conversations")
    @ResponseStatus(HttpStatus.CREATED)
    public Conversation createConversation(@PathVariable String accountId, @RequestBody ConversationCreateRequest input) {
        return service.createConversation(accountId, input);
    }

    @GetMapping("/accounts/{accountId}/conversations/{conversationId}/messages")
    public Map<String, Object> messages(@PathVariable String accountId, @PathVariable String conversationId) {
        return Map.of("items", service.listMessages(accountId, conversationId));
    }

    @PostMapping("/accounts/{accountId}/conversations/{conversationId}/messages")
    @ResponseStatus(HttpStatus.CREATED)
    public Message sendMessage(@PathVariable String accountId, @PathVariable String conversationId, @RequestBody MessageCreateRequest input) {
        return service.sendMessage(accountId, conversationId, input);
    }

    @PostMapping(value = "/accounts/{accountId}/conversations/{conversationId}/media", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    @ResponseStatus(HttpStatus.CREATED)
    public Message sendMedia(@PathVariable String accountId, @PathVariable String conversationId,
                             @RequestParam("file") MultipartFile file,
                             @RequestParam(value = "caption", required = false) String caption,
                             @RequestParam(value = "clientRef", required = false) String clientRef) throws IOException {
        return service.sendMediaMessage(accountId, conversationId, readUpload(file, "message"), caption, clientRef);
    }

    @PutMapping(value = "/accounts/{accountId}/avatar", consumes = MediaType.MULTIPART_FORM_DATA_VALUE)
    public Account updateAvatar(@PathVariable String accountId, @RequestParam("file") MultipartFile file) throws IOException {
        return service.updateAccountAvatar(accountId, readUpload(file, "avatar"));
    }

    @DeleteMapping("/accounts/{accountId}/avatar")
    public Account removeAvatar(@PathVariable String accountId) {
        return service.removeAccountAvatar(accountId);
    }

    @GetMapping("/media/{mediaId}")
    public ResponseEntity<byte[]> media(@PathVariable String mediaId, @RequestHeader(value = "Range", required = false) String range) {
        ControlCenterService.MediaRead read = service.openMedia(mediaId, range);
        StoredMediaObject object = read.object();
        HttpHeaders headers = new HttpHeaders();
        headers.set("Accept-Ranges", "bytes");
        headers.setCacheControl(CacheControl.maxAge(java.time.Duration.ofHours(1)).cachePrivate());
        headers.setContentType(MediaType.parseMediaType(object.contentType() == null ? read.asset().mimeType() : object.contentType()));
        headers.setContentDisposition(ContentDisposition.inline().filename(headerFileName(read.asset().fileName())).build());
        if (object.contentLength() != null) headers.setContentLength(object.contentLength());
        if (object.contentRange() != null) headers.set("Content-Range", object.contentRange());
        return new ResponseEntity<>(object.body(), headers, object.contentRange() == null ? HttpStatus.OK : HttpStatus.PARTIAL_CONTENT);
    }

    @PostMapping("/webhooks/evolution/{accountId}")
    public ResponseEntity<Void> webhook(@PathVariable String accountId,
                                        @RequestHeader(value = "x-control-webhook-secret", required = false) String secret,
                                        @RequestBody Map<String, Object> payload) {
        String configured = properties.evolution().webhookSecret();
        if (!configured.equals(secret)) return ResponseEntity.status(HttpStatus.UNAUTHORIZED).build();
        service.handleEvolutionWebhook(accountId, payload);
        return ResponseEntity.noContent().build();
    }

    @GetMapping("/events")
    public SseEmitter events() {
        return service.subscribe();
    }

    @ExceptionHandler(IllegalArgumentException.class)
    public ResponseEntity<Map<String, String>> badRequest(IllegalArgumentException error) {
        HttpStatus status = "账号不存在".equals(error.getMessage()) || "媒体不存在".equals(error.getMessage()) ? HttpStatus.NOT_FOUND : HttpStatus.BAD_REQUEST;
        return ResponseEntity.status(status).body(Map.of("error", error.getMessage()));
    }

    private UploadedMedia readUpload(MultipartFile file, String purpose) throws IOException {
        if (file == null || file.isEmpty()) throw new IllegalArgumentException("请选择要上传的文件");
        byte[] body = file.getBytes();
        MediaKind kind = mediaKind(file.getContentType());
        if ("avatar".equals(purpose) && kind != MediaKind.IMAGE)
            throw new IllegalArgumentException("头像仅支持 JPEG、PNG 或 WebP 图片");
        WaControlProperties.Upload upload = properties.media().upload();
        long limit = kind == MediaKind.IMAGE ? ("avatar".equals(purpose) ? upload.maxAvatarBytes() : upload.maxImageBytes()) : upload.maxVideoBytes();
        if (body.length > limit)
            throw new IllegalArgumentException(kind == MediaKind.IMAGE ? "图片不能超过 10 MB，头像不能超过 5 MB" : "视频不能超过 64 MB");
        if (!matchesSignature(body, file.getContentType()))
            throw new IllegalArgumentException("文件内容与媒体类型不匹配");
        return new UploadedMedia(body, file.getOriginalFilename() == null ? defaultName(kind) : file.getOriginalFilename(), file.getContentType(), body.length, kind);
    }

    private static MediaKind mediaKind(String mimeType) {
        if ("image/jpeg".equals(mimeType) || "image/png".equals(mimeType) || "image/webp".equals(mimeType))
            return MediaKind.IMAGE;
        if ("video/mp4".equals(mimeType)) return MediaKind.VIDEO;
        throw new IllegalArgumentException("仅支持 JPEG、PNG、WebP 图片和 MP4 视频");
    }

    private static boolean matchesSignature(byte[] body, String mimeType) {
        if ("image/jpeg".equals(mimeType))
            return body.length >= 3 && (body[0] & 0xff) == 0xff && (body[1] & 0xff) == 0xd8 && (body[2] & 0xff) == 0xff;
        if ("image/png".equals(mimeType))
            return body.length >= 8 && body[0] == (byte) 0x89 && body[1] == 0x50 && body[2] == 0x4e && body[3] == 0x47 && body[4] == 0x0d && body[5] == 0x0a && body[6] == 0x1a && body[7] == 0x0a;
        if ("image/webp".equals(mimeType))
            return body.length >= 12 && new String(body, 0, 4).equals("RIFF") && new String(body, 8, 4).equals("WEBP");
        if ("video/mp4".equals(mimeType)) return body.length >= 12 && new String(body, 4, 4).equals("ftyp");
        return false;
    }

    private static String defaultName(MediaKind kind) {
        return kind == MediaKind.IMAGE ? "image.jpg" : "video.mp4";
    }

    private static String headerFileName(String value) {
        String name = value.replaceAll("[^a-zA-Z0-9._-]", "_");
        return name.isBlank() ? "media" : name.substring(Math.max(0, name.length() - 120));
    }
}
