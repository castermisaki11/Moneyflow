import type { CookieOptions, Request } from "express";

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "0.0.0.0"]);

function isIpAddress(host: string) {
  // Basic IPv4 check and IPv6 presence detection.
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return true;
  return host.includes(":");
}

// ตรวจสอบว่า hostname เป็น localhost หรือ IP address
function isLocalhost(hostname: string): boolean {
  return LOCAL_HOSTS.has(hostname) || isIpAddress(hostname);
}

function isSecureRequest(req: Request) {
  if (req.protocol === "https") return true;
  
  // ตรวจสอบ x-forwarded-proto header
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (forwardedProto) {
    const protoList = Array.isArray(forwardedProto)
      ? forwardedProto
      : forwardedProto.split(",");
    if (protoList.some(proto => proto.trim().toLowerCase() === "https")) {
      return true;
    }
  }
  
  // ตรวจสอบว่าเป็น localhost หรือ 127.0.0.1 ให้ถือว่า secure
  const hostname = req.hostname || "";
  if (LOCAL_HOSTS.has(hostname)) {
    return true;
  }
  
  return false;
}

export function getSessionCookieOptions(
  req: Request
): Pick<CookieOptions, "domain" | "httpOnly" | "path" | "sameSite" | "secure"> {
  // const hostname = req.hostname;
  // const shouldSetDomain =
  //   hostname &&
  //   !LOCAL_HOSTS.has(hostname) &&
  //   !isIpAddress(hostname) &&
  //   hostname !== "127.0.0.1" &&
  //   hostname !== "::1";

  // const domain =
  //   shouldSetDomain && !hostname.startsWith(".")
  //     ? `.${hostname}`
  //     : shouldSetDomain
  //       ? hostname
  //       : undefined;

  const isSecure = isSecureRequest(req);
  
  return {
    httpOnly: true,
    path: "/",
    sameSite: isSecure ? "none" : "lax",
    secure: isSecure,
  };
}
