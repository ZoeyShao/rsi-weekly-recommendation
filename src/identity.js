import { createHmac, randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { getCookie, setCookie } from "hono/cookie";

export async function createIdentity({ dataDirectory, basePath, secure }) {
  await mkdir(dataDirectory, { recursive: true });
  const path = join(dataDirectory, "identity.key");
  try { await writeFile(path, randomBytes(32).toString("hex"), { flag: "wx", mode: 0o600 }); }
  catch (error) { if (error.code !== "EEXIST") throw error; }
  const key = await readFile(path, "utf8");
  const sign = id => createHmac("sha256", key).update(id).digest("hex");
  return (c) => {
    if (c.get("userId")) return c.get("userId");
    const raw = getCookie(c, "rsi_user_id") || "";
    const [candidate, signature] = raw.split(".");
    const valid = /^[0-9a-f-]{36}$/.test(candidate) && /^[0-9a-f]{64}$/.test(signature || "")
      && timingSafeEqual(Buffer.from(signature), Buffer.from(sign(candidate)));
    const id = valid ? candidate : randomUUID();
    if (!valid) setCookie(c, "rsi_user_id", `${id}.${sign(id)}`, {
      httpOnly: true, sameSite: "Lax", secure, path: basePath || "/", maxAge: 60 * 60 * 24 * 365,
    });
    c.set("userId", id);
    return id;
  };
}
