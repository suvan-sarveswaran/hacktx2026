import { createHash, randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

/** Random, HttpOnly browser credentials; only their hashes are saved beside lessons. */
export class VisitorAccess {
  constructor(private dataDir: string, private localOnly = false) {}
  visitor(req: IncomingMessage, res: ServerResponse): string {
    const publicOrigin = process.env.PUBLIC_ORIGIN;
    const secure = Boolean(publicOrigin?.startsWith("https://")) || req.headers["x-forwarded-proto"] === "https";
    const cookieName = secure ? "__Host-entertainify" : "entertainify-session";
    const supplied = req.headers.cookie?.split(";").map(part => part.trim()).find(part => part.startsWith(`${cookieName}=`))?.slice(cookieName.length + 1);
    const token = supplied && /^[a-f0-9]{64}$/.test(supplied) ? supplied : randomBytes(32).toString("hex");
    res.setHeader("Set-Cookie", `${cookieName}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000${secure ? "; Secure" : ""}`);
    // The shared legacy library is available only in explicitly local mode and
    // only on a direct loopback request. Proxies and deployed servers never opt in.
    if (this.localOnly && /^(localhost|127\.0\.0\.1|\[::1\])(:\d+)?$/.test(req.headers.host ?? "") &&
        ["127.0.0.1", "::1", "::ffff:127.0.0.1"].includes(req.socket.remoteAddress ?? "") &&
        !["forwarded", "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "cf-connecting-ip"].some(name => req.headers[name])) return "local";
    return createHash("sha256").update(token).digest("hex");
  }
  claim(id: string, visitor: string) {
    writeFileSync(join(this.dataDir, id, ".owner"), visitor, { flag: "wx", mode: 0o600 });
  }
  owns(id: string, visitor: string): boolean {
    if (visitor === "local") return true;
    const file = join(this.dataDir, id, ".owner");
    return existsSync(file) && readFileSync(file, "utf8") === visitor;
  }
}
