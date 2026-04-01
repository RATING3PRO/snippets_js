export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    
    // 目标 GHCR Registry 和 Auth 地址 (GHCR 二者同域)
    const GHCR = "https://ghcr.io";

    // 构建发往上游的 URL
    const upstreamUrl = new URL(url.pathname, GHCR);
    upstreamUrl.search = url.search;

    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.delete("Host"); 
    modifiedHeaders.delete("cf-connecting-ip");

    // 缓存控制策略
    let cacheTtl = 0; // 默认不缓存
    let cacheEverything = false;

    // Blobs (镜像层文件) - 内容不可变，可以长时间缓存
    if (method === "GET" && url.pathname.match(/\/v2\/.*\/blobs\/sha256:/)) {
      cacheTtl = 31536000; // 缓存 1 年
      cacheEverything = true;
    } 
    // Manifests (镜像清单) - 可能会更新（例如 latest 标签），设置较短缓存或不缓存
    // 这里为了加速拉取，可设置 60 秒短缓存
    else if (method === "GET" && url.pathname.match(/\/v2\/.*\/manifests\//)) {
      cacheTtl = 60; // 缓存 1 分钟
      cacheEverything = true;
    }

    const fetchOptions = {
      method,
      headers: modifiedHeaders,
      redirect: "manual", // 必须手动拦截重定向，类似于 Docker Hub 需要在重定向到云存储时卸载 Auth Header
    };

    // 应用 Cloudflare 的 cf 缓存选项
    if (cacheEverything && cacheTtl > 0) {
      fetchOptions.cf = {
        cacheTtl: cacheTtl,
        cacheEverything: true,
        cacheKey: request.url,
      };
    }

    const upstreamRequest = new Request(upstreamUrl, fetchOptions);
    let response = await fetch(upstreamRequest);

    // 手动处理 GHCR 给出的前往对象存储的 3xx 重定向链接
    // 拦截后单独发起纯净请求（保留基本头信息，丢弃 Authorization 避免云存储校验错误）
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (location) {
        const redirectHeaders = new Headers({
          "Accept": request.headers.get("Accept") || "*/*",
          "User-Agent": request.headers.get("User-Agent") || "docker",
        });

        const redirectFetchOptions = {
          method,
          headers: redirectHeaders,
          redirect: "follow",
        };
        
        // 确保下载的大文件被缓存到边缘节点
        if (cacheEverything && cacheTtl > 0) {
          redirectFetchOptions.cf = {
            cacheTtl: cacheTtl,
            cacheEverything: true,
            cacheKey: request.url,
          };
        }

        response = await fetch(location, redirectFetchOptions);
      }
    }

    // 重写 Www-Authenticate 响应头，确保证书和 Auth 请求也通过当前反代节点进行授权访问
    if (response.status === 401) {
      const wwwAuth = response.headers.get("Www-Authenticate");
      // GHCR 的 Authorization Endpoint 同样在 ghcr.io
      if (wwwAuth && wwwAuth.includes("ghcr.io")) {
        const newResponse = new Response(response.body, response);
        const newAuthHeader = wwwAuth.replace(/https:\/\/ghcr\.io/g, `${url.origin}`);
        newResponse.headers.set("Www-Authenticate", newAuthHeader);
        return newResponse;
      }
    }

    return response;
  }
};