export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const method = request.method;

    // 目标 Telegram API 地址
    const TELEGRAM_API = "https://api.telegram.org";

    // 访问根路径时直接重定向到源站
    if (url.pathname === "/") {
      return Response.redirect(TELEGRAM_API, 302);
    }

    // 构造请求的 URL
    const upstreamUrl = new URL(url.pathname, TELEGRAM_API);
    upstreamUrl.search = url.search;

    // 创建新的 Headers 并移除 Cloudflare 添加的特定 Header
    const modifiedHeaders = new Headers(request.headers);
    modifiedHeaders.delete("Host");
    modifiedHeaders.delete("cf-connecting-ip");

    const fetchOptions = {
      method,
      headers: modifiedHeaders,
      body: request.body,
      // Telegram API 偶尔也可能有重定向，这里看情况配置，通常直接使用 follow 即可
      redirect: "follow",
    };

    const upstreamRequest = new Request(upstreamUrl, fetchOptions);
    const response = await fetch(upstreamRequest);

    return response;
  }
};
