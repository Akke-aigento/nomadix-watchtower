/** Mag een site in een kader (iframe) binnen Watchtower? Kijkt naar X-Frame-Options en CSP frame-ancestors. */
export async function frameCheck(
  url: string,
  ourOrigin: string,
): Promise<{ frameable: boolean; finalUrl?: string; reason: string | null }> {
  if (!/^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(\/|$)/i.test(url))
    return { frameable: false, reason: "geen https-adres" };
  try {
    const res = await fetch(url, {
      redirect: "follow",
      headers: { "User-Agent": "NomadixWatchtower/2 (+frame-check)" },
      signal: AbortSignal.timeout(6000),
    });
    const xfo = (res.headers.get("x-frame-options") ?? "").toLowerCase();
    const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
    const fa = csp.match(/frame-ancestors([^;]*)/)?.[1]?.trim() ?? "";
    const origin = ourOrigin.toLowerCase();
    const host = new URL(origin).host;
    const faOk =
      !fa ||
      fa.includes("*") ||
      fa.includes(origin) ||
      fa.includes(host) ||
      (fa.includes("'self'") && new URL(res.url).host === host);
    const xfoOk = !xfo || (xfo.includes("sameorigin") && new URL(res.url).host === host);
    const frameable = xfoOk && faOk;
    return {
      frameable,
      finalUrl: res.url,
      reason: frameable ? null : !xfoOk ? `X-Frame-Options: ${xfo}` : `frame-ancestors ${fa}`,
    };
  } catch (e) {
    return { frameable: false, reason: String(e).slice(0, 120) };
  }
}
