# Cloudflare Snippets / Workers 实用反代脚本

这个仓库包含了一些适用于 Cloudflare Snippets 或 Cloudflare Workers 的 JavaScript 反向代理脚本。

## 目录

- [Docker Hub 反向代理 (docker-hub-proxy.js)](#docker-hub-反向代理)
- [Telegram API 反向代理 (telegram-proxy.js)](#telegram-api-反向代理)
- [部署指南](#部署指南)

## Docker Hub 反向代理
由于网络原因，直接拉取 Docker Hub 镜像可能遇到阻碍。这个脚本部署在 Cloudflare 边缘节点后，可以作为一个 Docker Registry Mirror 使用。

**特点:**
* 代理认证 (`auth.docker.io`) 和 Registry (`registry-1.docker.io`) 请求。
* 对镜像清单 (Manifests) 文件提供短时间缓存（60秒）。
* 对镜像数据层 (Blobs) 文件提供长期缓存（1年），极大加速二次拉取并减少回源流量。
* 完美处理由于 Authorization header 导致 S3 Amazon 下载报 `Missing x-amz-content-sha256` 签名错误的问题。

**使用方法:**
部署并绑定自定义域名（例如 `docker.yourdomain.com`）后，直接在拉取命令前面加上你的代理域名即可：
* **拉取第三方/社区镜像**（原样拼接）：
  ```bash
  docker pull docker.yourdomain.com/smallstep/step-ca
  ```
* **拉取官方基础镜像**（注意：必须手动补全 `library/` 命名空间）：
  ```bash
  docker pull docker.yourdomain.com/library/nginx
  ```

## Telegram API 反向代理
在国内开发 Telegram Bot 时，由于 `api.telegram.org` 无法被直接访问，可以通过这个脚本将其代理至 Cloudflare 域名。

## 部署指南

以部署上述的任意脚本为例：

1. 登录到 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
2. 导航到 **Workers & Pages** -> **Overview**，点击 **Create application**，选择 **Create Worker**。
3. 输入个名字，点击 **Deploy**。
4. 进入 Worker 详情，点击 **Edit code**。
5. 将仓库中你需要的 `xxx-proxy.js` 代码内容整体复制粘贴替换掉编辑器里的默认代码。
6. 点击右上角 **Save and deploy** 便可。
7. （可选）如果你想使用自己的域名，在 Worker 详情 -> **Settings** -> **Triggers** 下，添加一个 Custom Domain。
