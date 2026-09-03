# WA Control Fabric — Evolution API 云中控 MVP

这是一个真实可连接的 WhatsApp 云中控 MVP：Vue 3 操作台通过 Java/Spring Boot 控制服务管理 Evolution API 的独立 `WHATSAPP-BAILEYS` 实例，支持实例创建、二维码登录、在线状态、会话同步、文本/图片/视频收发、账号头像管理、消息回执、SSE 实时刷新和重启恢复。工程没有模拟账号、模拟消息或浏览器注入代码。

> Evolution 的 Baileys 模式基于 WhatsApp Web，并非 Meta 官方个人号 API。它不能承诺“零封号”；账号持有人应主动扫码授权，只向已同意的联系人发送正常消息，不做群发、骚扰或规避平台风控。需要最低平台风险和正式商业 SLA 时，应换用 Evolution 的官方 WhatsApp Cloud API integration。

## 架构

```text
Vue 3 Control UI
        │ REST + SSE + multipart
        ▼
Spring Boot Control API ───────── PostgreSQL-backed Evolution API v2.3.7
        │       ▲                                  │
        │       └──────── signed Webhook ──────────┤
        ▼                                          │ WHATSAPP-BAILEYS
  MinIO / S3              multipart media ────────►│
                                                   ▼
                                               WhatsApp Web
```

- `apps/web`：Vue 3 + TypeScript + Vite 云中控。
- `apps/server`：Java 17 + Spring Boot 控制 API、multipart 上传、SSE、账号映射和本地控制状态。
- `EvolutionProvider`：Evolution REST 适配、实例生命周期、二维码轮询、媒体收发、头像操作、会话/消息同步和 Webhook 标准化。
- `S3MediaStorage`：二进制媒体保存到 MinIO/S3；发送时由控制 API 通过 multipart 直接传给 Evolution，避免内部地址校验和签名参数被改写。
- `infra/evolution/docker-compose.yml`：基于 `evoapicloud/evolution-api:v2.3.7` 构建可审计的兼容镜像，配套 PostgreSQL 16、Redis 7 与 MinIO。
- `JsonStateStore`：保存中控账号与消息视图；Evolution 自身会话和密钥材料由其数据库/volume 保存。
- `apps/desktop`：Electron 桌面客户端，复用 Vue 操作台并通过 HTTPS 连接既有控制服务。

## 后端 Java 迁移

当前后端已经从 Node.js/Fastify 替换为 Java 17 + Spring Boot 3.3。前端架构保持 Vue 3 + TypeScript + Vite 不变，因为前端只依赖 `/api/*` REST、`/api/events` SSE 和 multipart 上传契约，不依赖 Node.js 后端内部实现。

新的后端边界：

- `ControlApiController`：提供账号、会话、消息、媒体、头像、Webhook、健康检查和 SSE 路由。
- `ControlCenterService`：维护中控账号状态、会话/消息视图、账号级串行操作、头像并发幂等和状态持久化。
- `EvolutionProvider`：负责 Evolution 实例生命周期、连接状态轮询、Webhook 标准化、历史同步和发送适配。
- `EvolutionClient`：封装 Evolution REST 调用，继续兼容 v2.3.7 的文本、multipart 媒体、头像和实例删除接口。
- `JsonStateStore` / `S3MediaStorage`：分别保存控制状态和 MinIO/S3 媒体对象。

迁移细节见 `docs/backend-java-migration.md`。

## 为什么固定 v2.3.7

官方 GitHub 当前稳定发布为 v2.3.7，官方 Docker 示例也固定该版本。2.4.0 仍处于 RC 阶段，并引入了必须先向许可服务激活、否则业务 API 返回 503 的破坏性变更。MVP 先固定稳定版以保证可复现；升级 2.4.x 前应单独评估许可、迁移和 API DTO 变化。

### v2.3.7 头像重连兼容修复

v2.3.7 在头像更新成功后会额外调用未等待的 `reloadConnection()`，可能让新旧 Baileys socket 互相产生 `conflict: replaced` 并进入重连循环。`infra/evolution/Dockerfile` 在构建时仅移除“更新/移除头像”两条路径的该调用，不改动其他 Evolution 逻辑；补丁会校验精确匹配次数，上游 bundle 发生变化时构建会直接失败，避免静默打错补丁。上游主分支已经不再在头像操作后调用该重连。

## 本地启动

环境要求：Java 17、Maven 3.9+、Node.js 20+、Docker Desktop（或可用的 Docker Engine）。

1. 复制 `.env.example` 为 `.env`，至少把三个示例密码/密钥改成长随机值。Docker Compose 和控制服务必须使用相同的 `EVOLUTION_API_KEY`。
2. 启动真实 Evolution 基础设施：

```bash
npm run infra:up
npm run infra:status
npm run infra:smoke
```

3. 安装依赖并启动中控：

```bash
npm install
npm run dev
```

4. 打开 `http://localhost:5273`，点击“添加 Evolution 实例”。二维码出现后，由账号持有人在手机 WhatsApp 的“已关联设备”中扫码。上线后即可真实收发文本、图片和 MP4 视频，并可在账号节点中更新头像或永久删除实例。

控制 API、前端开发服务、Evolution、Webhook 回调和 MinIO 地址都从配置读取；`.env.example` 中的本地默认值分别是 `http://localhost:4100`、`http://localhost:5273`、`http://127.0.0.1:8080`、`http://host.docker.internal:4100` 和 `127.0.0.1:9000/9001`。出站媒体由控制 API 直接 multipart 上传给 Evolution。

## 配置

Java 后端配置文件为 `apps/server/src/main/resources/application.yaml`，根目录 `.env` 用于覆盖本地运行参数。Spring Boot 启动时会读取当前目录、上一级目录或上两级目录中的 `.env`，所以既可以用 `npm run dev` 启动，也可以在 IDEA 中直接启动 `ControlApiApplication`。

常用配置项：

- `PORT` / `HOST`：控制 API 监听地址。
- `WEB_PORT` / `WEB_HOST` / `CONTROL_API_PROXY_TARGET`：Vite 前端监听地址和 `/api` 代理目标。
- `EVOLUTION_API_URL` / `EVOLUTION_API_KEY`：控制 API 访问 Evolution 的地址和密钥。
- `EVOLUTION_PUBLIC_WEBHOOK_URL` / `EVOLUTION_WEBHOOK_SECRET`：Evolution 回调控制 API 的公网或宿主机地址，以及 Webhook 校验密钥。
- `MEDIA_S3_*`：MinIO/S3 媒体存储配置。
- `MEDIA_MAX_IMAGE_BYTES` / `MEDIA_MAX_VIDEO_BYTES` / `MEDIA_MAX_AVATAR_BYTES`：上传大小限制。
- `REQUEST_LOG_ENABLED` / `REQUEST_LOG_INCLUDE_BODY` / `REQUEST_LOG_MAX_BODY_LENGTH`：接口请求日志开关、请求体打印开关和最大打印长度。

## 请求日志

后端已加入 Spring AOP 请求日志，覆盖所有 `@RestController` 接口，包括 `/api/webhooks/evolution/{accountId}`。日志会打印 HTTP 方法、接口路径、耗时 `durationMs`，并在 `REQUEST_LOG_INCLUDE_BODY=true` 时打印请求 body；multipart 文件对象会跳过二进制内容，只保留可序列化的普通参数，避免把图片或视频字节刷进日志。

## Electron 桌面端

桌面端只封装操作台，不打包或启动 Fastify、Evolution、PostgreSQL、Redis、MinIO。生产环境应将这些服务部署在服务器或内网节点，桌面端通过 HTTPS 访问控制 API；这样桌面程序退出不会影响账号会话、Webhook 或消息接收。

```text
WA Control Fabric.exe ── HTTPS / SSE ──► Fastify Control API ──► Evolution + PostgreSQL + MinIO
```

首次启动时，桌面端默认连接本机 `http://127.0.0.1:4100`，适用于本机开发或同机部署。若控制服务部署在服务器上，在左侧底部的“桌面端连接设置”中填入服务端 HTTPS 根地址并保存，应用会自动重载。媒体、REST 请求和 SSE 都会使用该地址。

桌面端使用受限的 `app://` 协议加载本地资源，并启用 sandbox、context isolation 和最小化 preload IPC；Renderer 不拥有 Node.js 或文件系统权限。发布到用户设备前仍应为 Fastify 加入 HTTPS、身份认证、RBAC 与 CORS allowlist。

### 浏览器档案

Electron 左侧导航的“浏览器档案”入口独立于云中控和 Java 服务。桌面端使用本地 Node.js 运行时、Patchright 与系统已安装的 Chrome/Edge 启动持久化 Chromium Context；每个档案拥有独立数据目录，所以 Cookie、缓存、LocalStorage 和登录状态互不混用。界面支持创建、编辑、删除、启动、停止与状态轮询，并可设置档案名称、责任人、用途、浏览器类型、代理地址及认证、打开网站、IANA 时区和语言。

“增强指纹”模式会在创建档案时生成并持久化一组固定的 UA、屏幕、Canvas/WebGL、语言和设备参数，每次启动复用；“浏览器原生”模式则保留系统 Chromium 的原生指纹行为。代理密码通过 Electron `safeStorage` 加密后落盘。运行中的档案会显示仅监听 `127.0.0.1` 的临时 CDP 地址，可供本机自动化程序连接。

该实现适合已授权账号的会话隔离、代理绑定和可见自动化，但注入式指纹不等同于定制 Chromium 内核，也不承诺对所有风控系统不可检测。浏览器运行完全位于 Electron 客户端，不改变云中控 Java 服务或 Evolution/Baileys 实例。

## Webhook 安全

控制服务在每次实例连接时都会重新配置 Webhook，并写入 `x-control-webhook-secret` 请求头。只有与 `EVOLUTION_WEBHOOK_SECRET` 一致的回调才会被接受。生产环境还应使用 HTTPS、反向代理 IP allowlist、密钥托管、RBAC 和审计日志。

## v2.3.x 关联设备配置

Compose 默认启用了 Evolution v2.3.x QR/Pairing 故障的减载配置：关闭 Evolution 的 Redis 会话缓存，改用本地缓存，并关闭首次历史/联系人/聊天/标签写入，保留实时新消息及消息状态入库。这用于避免 Docker 环境在生成 pre-key 与处理首次历史数据时发生 408/515 并被 WhatsApp 踢下线。Evolution v2.3.7 会自动获取当前 WhatsApp Web 版本，不再支持 `CONFIG_SESSION_PHONE_VERSION`。Redis 服务仍保留，供控制层后续扩容使用；在确认账号稳定上线且资源充足后，才应逐项压测恢复历史同步。

## 已实现的真实链路

- 中控账号与 Evolution instance 一一映射
- 创建/复用 `WHATSAPP-BAILEYS` 实例并获取二维码
- 轮询连接状态、扫码上线、登出与自动恢复；`connecting` 期间不重复请求建立新 socket
- Evolution 数据库中的最近会话和消息同步
- `/message/sendText` 真实文本发送（v2.3.7 DTO，并兼容更早版本）
- `/message/sendMedia` 使用 multipart 真实发送图片/视频；JPEG、PNG、WebP 最大 10 MB，MP4 最大 64 MB
- `/chat/updateProfilePicture` 使用裁剪后纯 Base64 更新头像，`/chat/removeProfilePicture` 移除头像
- `/instance/delete` 永久删除 Evolution 实例，并级联清理云中控会话、消息和媒体
- 浏览器端头像 512×512 居中裁剪、媒体预览、说明文字和发送状态
- 出站与入站媒体保存到 MinIO/S3；状态数据只保存元数据，不保存 Base64
- 同一账号的文本、媒体和头像操作串行执行，相同头像的并发请求复用同一个任务，不同账号之间可并行
- `MESSAGES_UPSERT`、`MESSAGES_UPDATE`、`CONNECTION_UPDATE` 等 Webhook
- 入站文本/图片/视频、送达/已读状态经 SSE 实时推送到 Vue 界面
- 控制状态原子持久化；Evolution 会话由 PostgreSQL/volume 持久化，当前配对阶段使用本地缓存

## 扩到上百账号

当前 Provider、媒体存储和 instance 模型可以直接保留。单进程内已经按账号串行化发送；生产扩容到多控制节点时，仍需将控制状态从 JSON 换成 PostgreSQL，把账号操作队列迁移到 Redis Streams/BullMQ/NATS/Kafka，并加入跨节点 Worker 租约。Evolution API 应按实例分片，绝不能让多个 Evolution Worker 同时持有同一 instance。MinIO 可直接换成云厂商 S3，只需调整环境变量。

## 命令

```bash
npm run dev           # 同时启动 Spring Boot API 与 Vue Web
npm run build         # Java 后端打包和前端生产构建
npm test              # Java 控制 API 与 Provider 合同测试
npm start             # 启动已打包的 Java 控制 API
npm run infra:up      # 启动 PostgreSQL、Redis、Evolution
npm run infra:status  # 查看基础设施状态
npm run infra:logs    # 查看 Evolution 日志
npm run infra:smoke   # 验证 Evolution 健康状态
npm run infra:down    # 停止容器（保留数据卷）
npm run desktop:dev   # 启动 Electron + Vite 热更新开发环境
npm run desktop:pack  # 生成 Windows 目录包（apps/desktop/release/win-unpacked）
npm run desktop:dist  # 生成 Windows NSIS 安装程序
=======
