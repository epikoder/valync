import {
	AsyncData,
	AsyncError,
	AsyncLoading,
	AsyncObserver,
	normalizeKey,
	mergeHeaders,
	buildRequestBody,
} from "../src/core/index";
import { DefaultValyncClient } from "../src/core/util";
import { Some, None } from "ts-results-es";

// ─── AsyncValue ────────────────────────────────────────────────────────────────

describe("AsyncValue", () => {
	it("wraps data correctly", () => {
		const result = new AsyncData(Some(123));
		expect(result.isData()).toBe(true);
		expect(result.value.unwrap()).toBe(123);
	});

	it("represents loading state", () => {
		const loading = new AsyncLoading();
		expect(loading.isLoading()).toBe(true);
		expect(loading.isData()).toBe(false);
		expect(loading.isError()).toBe(false);
	});

	it("represents error state", () => {
		const error = new AsyncError({
			name: "NetworkError",
			message: "Something went wrong",
			code: "500",
		});
		expect(error.isError()).toBe(true);
		expect(error.error.message).toBe("Something went wrong");
	});

	it("when() dispatches to loading handler", () => {
		expect(new AsyncLoading().when({ loading: () => "loading" })).toBe("loading");
	});

	it("when() dispatches to data handler", () => {
		expect(
			new AsyncData(Some("hello")).when({ data: (v) => v.unwrap() }),
		).toBe("hello");
	});

	it("when() dispatches to error handler", () => {
		expect(
			new AsyncError({ name: "E", message: "oops" }).when({
				error: (e) => e.message,
			}),
		).toBe("oops");
	});

	it("when() returns undefined when handler is missing", () => {
		expect(new AsyncLoading().when({})).toBeUndefined();
		expect(new AsyncData(None).when({})).toBeUndefined();
		expect(new AsyncError({ name: "E", message: "e" }).when({})).toBeUndefined();
	});
});

// ─── AsyncObserver ─────────────────────────────────────────────────────────────

describe("AsyncObserver", () => {
	it("calls listener immediately with current value on listen()", () => {
		const initial = new AsyncData(Some(1));
		const obs = new AsyncObserver(initial);
		const received: any[] = [];
		obs.listen((v) => received.push(v));
		expect(received).toHaveLength(1);
		expect(received[0]).toBe(initial);
	});

	it("notifies all listeners on set()", () => {
		const obs = new AsyncObserver(new AsyncData(Some(1)));
		const a: any[] = [];
		const b: any[] = [];
		obs.listen((v) => a.push(v));
		obs.listen((v) => b.push(v));
		const next = new AsyncData(Some(2));
		obs.set(next);
		expect(a[1]).toBe(next);
		expect(b[1]).toBe(next);
	});

	it("observer() does not call listener immediately", () => {
		const obs = new AsyncObserver(new AsyncData(Some(1)));
		const received: any[] = [];
		obs.observer().listen((v) => received.push(v));
		expect(received).toHaveLength(0);
	});

	it("unsubscribe stops notifications", () => {
		const obs = new AsyncObserver(new AsyncData(Some(1)));
		const received: any[] = [];
		const unsub = obs.listen((v) => received.push(v));
		unsub();
		obs.set(new AsyncData(Some(2)));
		expect(received).toHaveLength(1); // only the initial immediate call
	});
});

// ─── normalizeKey ──────────────────────────────────────────────────────────────

describe("normalizeKey", () => {
	it("returns string key as-is", () => {
		expect(normalizeKey("/api/users")).toBe("/api/users");
	});

	it("normalizes object key to URL+search params string", () => {
		expect(normalizeKey({ url: "/api/users", page: "1", limit: "10" })).toBe(
			"/api/users?page=1&limit=10",
		);
	});

	it("produces consistent output for the same object shape", () => {
		const a = normalizeKey({ url: "/api", foo: "1", bar: "2" });
		const b = normalizeKey({ url: "/api", foo: "1", bar: "2" });
		expect(a).toBe(b);
	});
});

// ─── mergeHeaders ─────────────────────────────────────────────────────────────

describe("mergeHeaders", () => {
	it("returns empty object for no arguments", () => {
		expect(mergeHeaders()).toEqual({});
	});

	it("merges two plain header objects", () => {
		expect(mergeHeaders({ "x-a": "1" }, { "x-b": "2" })).toEqual({
			"x-a": "1",
			"x-b": "2",
		});
	});

	it("later values override earlier ones", () => {
		expect(mergeHeaders({ "x-token": "old" }, { "x-token": "new" })["x-token"]).toBe("new");
	});

	it("handles Headers instance", () => {
		const h = new Headers({ "content-type": "application/json" });
		const result = mergeHeaders(h, { authorization: "Bearer token" });
		expect(result["content-type"]).toBe("application/json");
		expect(result["authorization"]).toBe("Bearer token");
	});

	it("handles string[][] format", () => {
		expect(mergeHeaders([["x-custom", "value"]])["x-custom"]).toBe("value");
	});

	it("handles undefined gracefully", () => {
		expect(mergeHeaders(undefined, { foo: "bar" })).toEqual({ foo: "bar" });
		expect(mergeHeaders({ foo: "bar" }, undefined)).toEqual({ foo: "bar" });
	});
});

// ─── buildRequestBody ─────────────────────────────────────────────────────────

describe("buildRequestBody", () => {
	it("returns undefined for no arguments", () => {
		const { body, isMultipart } = buildRequestBody();
		expect(body).toBeUndefined();
		expect(isMultipart).toBe(false);
	});

	it("returns null as-is", () => {
		const { body, isMultipart } = buildRequestBody(null);
		expect(body).toBeNull();
		expect(isMultipart).toBe(false);
	});

	it("JSON.stringify-s plain objects", () => {
		const obj = { name: "Alice", age: 30 };
		const { body, isMultipart } = buildRequestBody(obj);
		expect(body).toBe(JSON.stringify(obj));
		expect(isMultipart).toBe(false);
	});

	it("returns string BodyInit as-is", () => {
		const { body, isMultipart } = buildRequestBody('{"hello":"world"}');
		expect(body).toBe('{"hello":"world"}');
		expect(isMultipart).toBe(false);
	});

	it("returns existing FormData body as multipart", () => {
		const fd = new FormData();
		fd.append("key", "value");
		const { body, isMultipart } = buildRequestBody(fd);
		expect(body).toBe(fd);
		expect(isMultipart).toBe(true);
	});

	it("returns Blob as-is (non-plain object, not multipart)", () => {
		const blob = new Blob(["data"], { type: "text/plain" });
		const { body, isMultipart } = buildRequestBody(blob);
		expect(body).toBe(blob);
		expect(isMultipart).toBe(false);
	});

	it("ignores empty files array and falls through to body handling", () => {
		const obj = { key: "value" };
		const { body, isMultipart } = buildRequestBody(obj, []);
		expect(body).toBe(JSON.stringify(obj));
		expect(isMultipart).toBe(false);
	});

	it("builds FormData from File[] using default 'file' key", () => {
		const file = new File(["content"], "test.txt", { type: "text/plain" });
		const { body, isMultipart } = buildRequestBody(undefined, [file]);
		expect(body).toBeInstanceOf(FormData);
		expect(isMultipart).toBe(true);
		expect((body as FormData).get("file")).toBe(file);
	});

	it("builds FormData from [string, File][] with named keys", () => {
		const file = new File(["content"], "avatar.png", { type: "image/png" });
		const { body, isMultipart } = buildRequestBody(undefined, [["avatar", file]]);
		expect(body).toBeInstanceOf(FormData);
		expect(isMultipart).toBe(true);
		expect((body as FormData).get("avatar")).toBe(file);
	});

	it("merges plain object fields and files into a single FormData", () => {
		const file = new File(["data"], "doc.pdf");
		const { body, isMultipart } = buildRequestBody(
			{ title: "My Doc", description: "upload" },
			[["document", file]],
		);
		expect(isMultipart).toBe(true);
		const fd = body as FormData;
		expect(fd.get("title")).toBe("My Doc");
		expect(fd.get("description")).toBe("upload");
		expect(fd.get("document")).toBe(file);
	});

	it("appends extra files to an existing FormData body", () => {
		const existingFd = new FormData();
		existingFd.append("existing", "value");
		const file = new File(["x"], "extra.txt");
		const { body, isMultipart } = buildRequestBody(existingFd, [["extra", file]]);
		expect(isMultipart).toBe(true);
		const fd = body as FormData;
		expect(fd.get("existing")).toBe("value");
		expect(fd.get("extra")).toBe(file);
	});

	it("handles multiple named files", () => {
		const f1 = new File(["a"], "a.jpg");
		const f2 = new File(["b"], "b.jpg");
		const { body } = buildRequestBody(undefined, [
			["image1", f1],
			["image2", f2],
		]);
		const fd = body as FormData;
		expect(fd.get("image1")).toBe(f1);
		expect(fd.get("image2")).toBe(f2);
	});
});

// ─── DefaultValyncClient ──────────────────────────────────────────────────────

describe("DefaultValyncClient", () => {
	const mockResponse = (
		status: number,
		body?: any,
		ok = true,
	): void => {
		jest.spyOn(globalThis, "fetch").mockResolvedValueOnce({
			status,
			ok,
			statusText: ok ? "OK" : "Server Error",
			json:
				body !== undefined
					? () => Promise.resolve(body)
					: () => Promise.reject(new SyntaxError("Unexpected end of JSON")),
		} as unknown as Response);
	};

	afterEach(() => jest.restoreAllMocks());

	it("returns success with null data for 204 No Content", async () => {
		mockResponse(204);
		const result = await DefaultValyncClient("/api/test", {});
		expect(result.status).toBe("success");
		expect((result as any).data).toBeNull();
	});

	it("parses and returns a successful ApiResponse body", async () => {
		mockResponse(200, { status: "success", data: { id: 42 } });
		const result = await DefaultValyncClient<{ id: number }>("/api/test", {});
		expect(result.status).toBe("success");
		expect((result as any).data).toEqual({ id: 42 });
	});

	it("returns ApiErrorResponse when JSON status is 'failed'", async () => {
		mockResponse(200, {
			status: "failed",
			error: { name: "NotFound", message: "Resource not found" },
		});
		const result = await DefaultValyncClient("/api/test", {});
		expect(result.status).toBe("failed");
		expect((result as any).error.name).toBe("NotFound");
		expect((result as any).error.message).toBe("Resource not found");
	});

	it("returns HttpError when response is not ok and body has no error field", async () => {
		mockResponse(500, { message: "crash" }, false);
		const result = await DefaultValyncClient("/api/test", {});
		expect(result.status).toBe("failed");
		expect((result as any).error.name).toBe("HttpError");
		expect((result as any).error.code).toBe(500);
	});

	it("prefers error field from JSON over generic HttpError on non-ok responses", async () => {
		mockResponse(
			422,
			{ status: "failed", error: { name: "ValidationError", message: "Invalid input" } },
			false,
		);
		const result = await DefaultValyncClient("/api/test", {});
		expect(result.status).toBe("failed");
		expect((result as any).error.name).toBe("ValidationError");
	});

	it("returns ParseError when response body is not valid JSON", async () => {
		mockResponse(200, undefined); // json() rejects
		const result = await DefaultValyncClient("/api/test", {});
		expect(result.status).toBe("failed");
		expect((result as any).error.name).toBe("ParseError");
		expect((result as any).error.code).toBe(200);
	});
});
