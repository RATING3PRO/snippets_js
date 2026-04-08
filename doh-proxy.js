export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // 目标上游 DoH 地址 (以 Google DoH 为例，可按需修改为 Cloudflare 的 https://security.cloudflare-dns.com/dns-query 等)
    const DOH_UPSTREAM = "https://dns.google/dns-query";

    // 访问根路径时重定向，避免直接暴露或者由于空白页引起困惑
    if (url.pathname === "/") {
      return Response.redirect("https://developers.google.com/speed/public-dns/docs/doh", 302);
    }

    // DoH 规范仅支持 GET 和 POST
    if (method !== "GET" && method !== "POST") {
      return new Response("Method not allowed", { status: 405 });
    }

    const upstreamUrl = new URL(DOH_UPSTREAM);
    // GET 请求时，DoH 查询报文会在 URL 参数 `?dns=...` 中传递
    if (method === "GET") {
      upstreamUrl.search = url.search;
    }

    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.delete("Host");
    modifiedHeaders.delete("cf-connecting-ip");

    const fetchOptions = {
      method,
      headers: modifiedHeaders,
      body: method === "POST" ? request.body : null,
    };

    // 针对 GET 请求开启全量缓存
    // DoH 标准协议中，上游服务器会根据解析出来的 DNS 记录的 TTL，自动下发 Cache-Control HTTP 响应头
    // 开启 cacheEverything 后，Cloudflare 边缘节点会完全遵循上游给定的标准 DNS TTL 进行边缘缓存，不多也不少
    if (method === "GET" && url.searchParams.has("dns")) {
      fetchOptions.cf = {
        cacheEverything: true,
      };
    }

    const upstreamRequest = new Request(upstreamUrl, fetchOptions);
    const response = await fetch(upstreamRequest);

    // 直接返回上游响应，响应头中已经包含了正确的 Content-Type: application/dns-message 和 Cache-Control
    return response;
  }
};
