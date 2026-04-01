export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;
    
    // 目标 Docker Registry 和 Auth 地址
    const DOCKER_HUB = "https://registry-1.docker.io";
    const DOCKER_AUTH = "https://auth.docker.io";

    // 路由：处理 Auth 请求
    if (url.pathname === "/token" || url.pathname === "/v2/auth") {
      const authUrl = new URL(url.pathname === "/v2/auth" ? "/token" : url.pathname, DOCKER_AUTH);
      authUrl.search = url.search;
      
      const authReq = new Request(authUrl, {
        method,
        headers: request.headers,
      });
      return fetch(authReq);
    }

    // 路由：处理 Registry API 请求
    const upstreamUrl = new URL(url.pathname, DOCKER_HUB);
    upstreamUrl.search = url.search;

    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.delete("Host"); // 交给 fetch 自动处理正确的 Host
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
      redirect: "manual", // 必须手动拦截重定向，否则自带的 follow 会把原先带有 Authorization 的 header 一并带给 S3，导致报错
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

    // 手动处理 Docker Hub 给出的前往 S3 的 3xx 重定向链接
    // 拦截后单独向 S3 发起纯净请求（丢弃 Authorization 避免签名混乱和 Missing x-amz-content-sha256 报错）
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get("Location");
      if (location) {
        const s3Headers = new Headers({
          "Accept": request.headers.get("Accept") || "*/*",
          "User-Agent": request.headers.get("User-Agent") || "docker",
        });

        const s3FetchOptions = {
          method,
          headers: s3Headers,
          redirect: "follow",
        };
        
        // 确保 S3 下载的大文件缓存到边缘节点
        if (cacheEverything && cacheTtl > 0) {
          s3FetchOptions.cf = {
            cacheTtl: cacheTtl,
            cacheEverything: true,
            cacheKey: request.url,
          };
        }

        response = await fetch(location, s3FetchOptions);
      }
    }

    // 重写 Www-Authenticate 响应头，确保证书和 Auth 请求也通过当前反代节点
    if (response.status === 401) {
      const wwwAuth = response.headers.get("Www-Authenticate");
      if (wwwAuth && wwwAuth.includes("auth.docker.io")) {
        const newResponse = new Response(response.body, response);
        // 将原 auth.docker.io 替换为当前的 origin 并映射到 /token 或者保留代理
        const newAuthHeader = wwwAuth.replace(/https:\/\/auth\.docker\.io/g, `${url.origin}`);
        newResponse.headers.set("Www-Authenticate", newAuthHeader);
        return newResponse;
      }
    }

    return response;
  }
};
