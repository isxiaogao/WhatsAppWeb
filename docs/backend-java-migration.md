# 后端 Java 迁移说明

## 迁移结论

该项目可以把后端从 Node.js/Fastify 更换为 Java。原工程的前后端边界主要是 `/api/*` REST、`/api/events` SSE 和 multipart 上传；Vue 3 前端没有直接依赖 Node.js 运行时或 Fastify 内部类型。因此只要 Java 后端保持同样的 HTTP 契约，前端架构可以不变。

## 迁移策略

- 保留 `apps/web` 的 Vue 3 + TypeScript + Vite 架构。
- 将 `apps/server` 改为 Java 17 + Spring Boot 3.3 控制 API。
- 控制 API、Vite 代理、Evolution、Webhook 回调和 MinIO 地址全部从配置读取，默认值集中在 `application.yaml` 和 `.env.example`。
- 保持账号、会话、消息、媒体、Webhook 和 SSE 的 JSON 字段结构。
- 继续使用 JSON 文件保存控制状态，后续扩容时再迁移到 PostgreSQL。
- 继续使用 MinIO/S3 保存媒体对象，发送媒体时由控制 API 以 multipart 传给 Evolution。

## 配置迁移

后端已从 `application.properties` 切换为 `apps/server/src/main/resources/application.yaml`。源码中的服务端口、监听地址、Evolution URL、Webhook URL、MinIO 地址、上传大小和请求日志开关都迁移到 `wa-control.*` 或 Spring Boot 原生配置项中。

本地运行时使用根目录 `.env` 覆盖默认值。`ControlApiApplication` 会在当前目录、上一级目录和上两级目录查找 `.env`，因此支持以下两种启动方式共享同一份配置：

- 根目录执行 `npm run dev`。
- IDEA 直接启动 `com.cloudwa.control.ControlApiApplication`。

前端 `apps/web/vite.config.ts` 会读取根目录 `.env`，如果 `.env` 不存在则使用 `.env.example` 的本地默认值。需要改前端端口或代理后端地址时，修改 `WEB_PORT`、`WEB_HOST`、`CONTROL_API_PROXY_TARGET` 即可。

## 请求日志

新增 `RequestLoggingAspect`，对所有 `@RestController` 接口打印请求日志，包括 Webhook。日志内容包含 HTTP 方法、URI、耗时 `durationMs`，并可通过 `REQUEST_LOG_INCLUDE_BODY` 控制是否打印请求体。multipart 上传会跳过文件二进制内容，避免大文件进入日志。

## 新后端模块

- `ControlApiController`：暴露 `/api/health`、账号、会话、消息、媒体、头像、Webhook 和 SSE 路由。
- `ControlCenterService`：维护本地控制状态、账号级串行队列、头像并发幂等、消息视图和事件发布。
- `EvolutionProvider`：管理 Evolution 实例生命周期、连接状态轮询、Webhook 归一化、历史会话/消息同步和发送适配。
- `EvolutionClient`：封装 Evolution REST API，包括实例、Webhook、文本、媒体、头像和消息媒体下载接口。
- `JsonStateStore` / `S3MediaStorage`：分别负责控制状态持久化和媒体对象存储。

## 命令变化

```bash
npm run dev
```

同时启动 Spring Boot API 和 Vite 前端。

```bash
npm test
```

运行 Java 后端契约测试。

```bash
npm run build
```

打包 Java 后端并构建前端。

```bash
npm start
```

运行 `apps/server/target/control-api-0.1.0.jar`。

## 保留的外部依赖

- Evolution API v2.3.7 仍由 `infra/evolution/docker-compose.yml` 提供。
- PostgreSQL、Redis、MinIO 的基础设施编排不变。
- `EVOLUTION_API_KEY`、`EVOLUTION_WEBHOOK_SECRET`、`MEDIA_S3_*` 等环境变量语义不变。

## 验证

新增 `ControlApiContractTest` 覆盖：

- 账号创建、连接、会话创建和文本发送。
- multipart 图片发送、媒体读取。
- 头像上传/删除和重复并发头像上传复用同一个 provider 操作。
- Evolution Webhook 鉴权与入站消息写入。
