import { describe, expect, spyOn, test } from "bun:test";
import axios, { AxiosError, AxiosHeaders } from "axios";
import { fetchText } from "../scripts/index";
import { EVENT } from "../scripts/sources";

function forbidden(): AxiosError {
  return new AxiosError("PRIVATE_ERROR_DETAIL", "ERR_BAD_REQUEST", undefined, undefined, {
    status: 403,
    statusText: "Forbidden",
    data: "PRIVATE_RESPONSE_BODY",
    headers: { "set-cookie": ["PRIVATE_COOKIE"] },
    config: { headers: new AxiosHeaders({ Authorization: "PRIVATE_TOKEN" }) },
  });
}

describe("public fetch diagnostics", () => {
  test("identifies the exact blocked URL and status without retries or sensitive response data", async () => {
    for (const path of ["/feed", "/sitemap.xml"]) {
      const url = `${EVENT.newsletter}${path}`;
      const get = spyOn(axios, "get").mockRejectedValue(forbidden());
      try {
        let failure: unknown;
        try { await fetchText(url); } catch (error) { failure = error; }
        expect(failure).toBeInstanceOf(Error);
        expect((failure as Error).message).toBe(`Failed to fetch ${url}: HTTP 403`);
        expect((failure as Error).message).not.toContain("PRIVATE_");
        expect(get).toHaveBeenCalledTimes(1);
      } finally { get.mockRestore(); }
    }
  });

  test("includes the source URL on an invalid response without logging the response", async () => {
    const get = spyOn(axios, "get").mockResolvedValue({ data: { private: "PRIVATE_RESPONSE_BODY" } });
    try {
      await expect(fetchText(EVENT.website)).rejects.toThrow(`Failed to fetch ${EVENT.website}: Invalid public-source response or redirect`);
    } finally { get.mockRestore(); }
  });

  test("still rejects unapproved sources before sending a request", async () => {
    const get = spyOn(axios, "get");
    try {
      await expect(fetchText("https://unapproved.example/feed")).rejects.toThrow("Unapproved public source");
      expect(get).not.toHaveBeenCalled();
    } finally { get.mockRestore(); }
  });
});
