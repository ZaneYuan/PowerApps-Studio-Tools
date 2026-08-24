import { describe, expect, it } from "vitest";
import { formatDataverseError } from "./errorFormatting";

function dataverseError(status: number, body: unknown): Error {
  return new Error(`Dataverse 请求失败 (${status}): ${typeof body === "string" ? body : JSON.stringify(body)}`);
}

describe("formatDataverseError", () => {
  it("401 gets a friendly auth-expired prefix plus Dataverse's own message", () => {
    const err = dataverseError(401, { error: { code: "0x1", message: "Invalid access token" } });
    const result = formatDataverseError(err);
    expect(result.summary).toBe("认证失败（登录已过期或凭据无效）：Invalid access token");
    expect(result.detail).toBe(err.message);
  });

  it("403 gets a friendly no-permission prefix", () => {
    const result = formatDataverseError(dataverseError(403, { error: { message: "Access denied" } }));
    expect(result.summary).toBe("没有权限执行此操作：Access denied");
  });

  it("404 gets a friendly not-found prefix", () => {
    const result = formatDataverseError(dataverseError(404, { error: { message: "Entity not found" } }));
    expect(result.summary).toBe("未找到（请求的资源不存在）：Entity not found");
  });

  it("429 gets a friendly rate-limit prefix", () => {
    const result = formatDataverseError(dataverseError(429, { error: { message: "Too many requests" } }));
    expect(result.summary).toBe("请求过于频繁，被 Dataverse 限流：Too many requests");
  });

  it("5xx gets a friendly server-error prefix", () => {
    const result = formatDataverseError(dataverseError(500, { error: { message: "Internal error" } }));
    expect(result.summary).toBe("Dataverse 服务器内部错误：Internal error");
  });

  it("an unmapped status code falls back to a generic HTTP-status prefix", () => {
    const result = formatDataverseError(dataverseError(418, { error: { message: "I'm a teapot" } }));
    expect(result.summary).toBe("请求失败（HTTP 418）：I'm a teapot");
  });

  it("a Dataverse-shaped error with a non-JSON body falls back to just the status prefix, detail still preserved", () => {
    const err = dataverseError(400, "not json at all");
    const result = formatDataverseError(err);
    expect(result.summary).toBe("请求失败（HTTP 400）");
    expect(result.detail).toBe(err.message);
  });

  it("JSON without the {error:{message}} envelope falls back to just the status prefix", () => {
    const result = formatDataverseError(dataverseError(400, { somethingElse: true }));
    expect(result.summary).toBe("请求失败（HTTP 400）");
  });

  it("an error that doesn't match the Dataverse HTTP-failure shape passes through unchanged, with no detail", () => {
    const err = new Error("找不到该连接，可能已被删除。");
    const result = formatDataverseError(err);
    expect(result.summary).toBe("找不到该连接，可能已被删除。");
    expect(result.detail).toBeNull();
  });

  it("a plain string thrown (not an Error) is stringified and passed through", () => {
    const result = formatDataverseError("network offline");
    expect(result.summary).toBe("network offline");
    expect(result.detail).toBeNull();
  });
});
