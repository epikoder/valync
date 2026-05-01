/**
 * @jest-environment jsdom
 */
import { createApp, nextTick } from "vue";
import { flushPromises } from "@vue/test-utils";
import { useValync, createValyn } from "../src/vue/index";
import { AsyncData, AsyncError, AsyncLoading } from "../src/core/index";
import { None } from "ts-results-es";

// ─── withSetup helper ─────────────────────────────────────────────────────────
// Runs a composable inside a minimal Vue app so onMounted/onUnmounted fire.

function withSetup<T>(composable: () => T): [T, () => void] {
	let result!: T;
	const app = createApp({
		setup() {
			result = composable();
			return () => null;
		},
	});
	const el = document.createElement("div");
	app.mount(el);
	return [result, () => app.unmount()];
}

// ─── fetch helpers ────────────────────────────────────────────────────────────

type MockFetch = jest.MockedFunction<typeof fetch>;

function makeFetchMock(status: number, body?: any, ok = true): MockFetch {
	return jest.fn().mockResolvedValueOnce({
		status,
		ok,
		statusText: ok ? "OK" : "Error",
		json:
			body !== undefined
				? () => Promise.resolve(body)
				: () => Promise.reject(new SyntaxError("no body")),
	} as unknown as Response) as MockFetch;
}

const success = (data: any) => {
	const m = makeFetchMock(200, { status: "success", data });
	global.fetch = m;
	return m;
};

const failure = (error: { name: string; message: string }) => {
	const m = makeFetchMock(200, { status: "failed", error });
	global.fetch = m;
	return m;
};

const noContent = () => {
	const m = makeFetchMock(204);
	global.fetch = m;
	return m;
};

afterEach(() => jest.clearAllMocks());

// ─── useValync (Vue) ──────────────────────────────────────────────────────────

describe("useValync (Vue)", () => {
	it("starts with AsyncData(None) when fetchOnMount is false", () => {
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/test", { fetchOnMount: false }),
		);
		const [state] = composable;
		expect(state.value).toBeInstanceOf(AsyncData);
		expect((state.value as AsyncData<any>).value).toBe(None);
		cleanup();
	});

	it("transitions to AsyncData(Some) on success", async () => {
		success({ name: "Alice" });
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/user-v1", { cache: false }),
		);
		const [state] = composable;

		await flushPromises();

		expect(state.value).toBeInstanceOf(AsyncData);
		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ name: "Alice" });
		cleanup();
	});

	it("transitions to AsyncError on a failed API response", async () => {
		failure({ name: "NotFound", message: "not found" });
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/user-v2", { cache: false }),
		);
		const [state] = composable;

		await flushPromises();

		expect(state.value).toBeInstanceOf(AsyncError);
		expect((state.value as AsyncError).error.name).toBe("NotFound");
		cleanup();
	});

	it("handles 204 No Content as AsyncData(Some(null))", async () => {
		noContent();
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/action-v1", { cache: false }),
		);
		const [state] = composable;

		await flushPromises();

		expect(state.value).toBeInstanceOf(AsyncData);
		expect((state.value as AsyncData<any>).value.unwrap()).toBeNull();
		cleanup();
	});

	it("calls onSuccess with the resolved data", async () => {
		success(42);
		const onSuccess = jest.fn();
		const [, cleanup] = withSetup(() =>
			useValync("/api/num-v1", { cache: false, onSuccess }),
		);

		await flushPromises();

		expect(onSuccess).toHaveBeenCalledWith(42);
		cleanup();
	});

	it("calls onError on an API failure", async () => {
		failure({ name: "Unauthorized", message: "No access" });
		const onError = jest.fn();
		const [, cleanup] = withSetup(() =>
			useValync("/api/secret-v1", { cache: false, onError }),
		);

		await flushPromises();

		expect(onError).toHaveBeenCalledWith(
			expect.objectContaining({ name: "Unauthorized" }),
		);
		cleanup();
	});

	it("does not fetch when fetchOnMount is false", () => {
		const spy = jest.fn() as MockFetch;
		global.fetch = spy;
		const [, cleanup] = withSetup(() =>
			useValync("/api/nofetch-v", { fetchOnMount: false }),
		);
		expect(spy).not.toHaveBeenCalled();
		cleanup();
	});

	it("seeds state from initialData without fetching", () => {
		const spy = jest.fn() as MockFetch;
		global.fetch = spy;
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/init-v1", {
				initialData: { status: "success", data: { preset: true } },
			}),
		);
		const [state] = composable;
		expect(spy).not.toHaveBeenCalled();
		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ preset: true });
		cleanup();
	});

	it("seeds an error state from a failed initialData", () => {
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/init-v2", {
				fetchOnMount: false,
				initialData: {
					status: "failed",
					error: { name: "Seeded", message: "pre-seeded error" },
				},
			}),
		);
		const [state] = composable;
		expect(state.value).toBeInstanceOf(AsyncError);
		expect((state.value as AsyncError).error.name).toBe("Seeded");
		cleanup();
	});

	it("applies onData transform to the raw response data", async () => {
		success({ raw: "VALUE" });
		const [composable, cleanup] = withSetup(() =>
			useValync("/api/transform-v1", {
				cache: false,
				onData: (d) => ({ transformed: d.raw.toLowerCase() }),
			}),
		);
		const [state] = composable;

		await flushPromises();

		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({
			transformed: "value",
		});
		cleanup();
	});

	it("setData updates state optimistically without a network call", async () => {
		success({ count: 0 });
		const [composable, cleanup] = withSetup(() =>
			useValync<{ count: number }>("/api/counter-v1", { cache: false }),
		);
		const [state, , setData] = composable;

		await flushPromises();
		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ count: 0 });

		setData((prev) => ({ count: (prev?.count ?? 0) + 1 }));
		await nextTick();

		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ count: 1 });
		cleanup();
	});

	it("fetchFn re-fetches on demand", async () => {
		success({ v: 1 });
		const [composable, cleanup] = withSetup(() =>
			useValync<{ v: number }>("/api/refetch-v1", { cache: false }),
		);
		const [state, fetchFn] = composable;

		await flushPromises();
		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ v: 1 });

		success({ v: 2 });
		fetchFn("GET");
		await flushPromises();

		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ v: 2 });
		cleanup();
	});

	it("fetchFn sends FormData when files are provided via object form", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementationOnce(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: "ok" }),
				} as Response);
			},
		) as MockFetch;

		const [composable, cleanup] = withSetup(() =>
			useValync("/api/upload-v1", { fetchOnMount: false }),
		);
		const [, fetchFn] = composable;
		const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });

		fetchFn({ method: "POST", files: [["photo", file]] });
		await flushPromises();

		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("photo")).toBe(file);
		cleanup();
	});

	it("fetchFn sends FormData via positional args", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementationOnce(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: "ok" }),
				} as Response);
			},
		) as MockFetch;

		const [composable, cleanup] = withSetup(() =>
			useValync("/api/upload-v2", { fetchOnMount: false }),
		);
		const [, fetchFn] = composable;
		const file = new File(["data"], "doc.pdf");

		fetchFn("POST", undefined, [["doc", file]]);
		await flushPromises();

		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("doc")).toBe(file);
		cleanup();
	});

	it("auto-sets content-type: application/json for plain object body", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementationOnce(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: {} }),
				} as Response);
			},
		) as MockFetch;

		const [composable, cleanup] = withSetup(() =>
			useValync("/api/json-v1", { fetchOnMount: false }),
		);
		const [, fetchFn] = composable;

		fetchFn("POST", { name: "test" });
		await flushPromises();

		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers?.["content-type"]).toBe("application/json");
		expect(capturedInit?.body).toBe(JSON.stringify({ name: "test" }));
		cleanup();
	});

	it("does NOT set content-type for FormData body (browser sets boundary)", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementationOnce(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: {} }),
				} as Response);
			},
		) as MockFetch;

		const [composable, cleanup] = withSetup(() =>
			useValync("/api/upload-v3", { fetchOnMount: false }),
		);
		const [, fetchFn] = composable;
		const fd = new FormData();
		fd.append("key", "value");

		fetchFn("POST", fd);
		await flushPromises();

		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers?.["content-type"]).toBeUndefined();
		cleanup();
	});
});

// ─── createValyn (Vue) ────────────────────────────────────────────────────────

describe("createValyn (Vue)", () => {
	it("retries once when global onError returns true", async () => {
		const client = jest
			.fn()
			.mockResolvedValueOnce({
				status: "failed",
				error: { name: "Unauthorized", message: "Token expired" },
			})
			.mockResolvedValueOnce({ status: "success", data: { retried: true } });

		const onError = jest.fn().mockResolvedValue(true);
		const useHook = createValyn({ client, options: { onError } });
		const [composable, cleanup] = withSetup(() =>
			useHook("/api/retry-v1", { cache: false }),
		);
		const [state] = composable;

		await flushPromises();

		expect(state.value).toBeInstanceOf(AsyncData);
		expect(client).toHaveBeenCalledTimes(2);
		expect((state.value as AsyncData<any>).value.unwrap()).toEqual({ retried: true });
		cleanup();
	});

	it("does not retry when global onError returns false", async () => {
		const client = jest.fn().mockResolvedValue({
			status: "failed",
			error: { name: "Forbidden", message: "Access denied" },
		});
		const onError = jest.fn().mockResolvedValue(false);
		const useHook = createValyn({ client, options: { onError } });
		const [composable, cleanup] = withSetup(() =>
			useHook("/api/retry-v2", { cache: false }),
		);
		const [state] = composable;

		await flushPromises();

		expect(state.value).toBeInstanceOf(AsyncError);
		expect(client).toHaveBeenCalledTimes(1);
		cleanup();
	});

	it("retries at most once — does not loop even if onError always returns true", async () => {
		const client = jest.fn().mockResolvedValue({
			status: "failed",
			error: { name: "Err", message: "always fails" },
		});
		const onError = jest.fn().mockResolvedValue(true);
		const useHook = createValyn({ client, options: { onError } });
		const [composable, cleanup] = withSetup(() =>
			useHook("/api/retry-v3", { cache: false }),
		);
		const [state] = composable;

		await flushPromises();

		expect(state.value).toBeInstanceOf(AsyncError);
		expect(client).toHaveBeenCalledTimes(2);
		cleanup();
	});

	it("calls dynamic headers function and merges into every request", async () => {
		let lastHeaders: any;
		const getHeaders = jest.fn(() => ({ authorization: "Bearer vue-token" }));
		const client = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
			lastHeaders = init.headers;
			return Promise.resolve({ status: "success", data: "ok" });
		});

		const useHook = createValyn({ client, options: { headers: getHeaders } });
		const [, cleanup] = withSetup(() =>
			useHook("/api/dyn-v1", { cache: false }),
		);

		await flushPromises();

		expect(getHeaders).toHaveBeenCalled();
		expect((lastHeaders as Record<string, string>)["authorization"]).toBe(
			"Bearer vue-token",
		);
		cleanup();
	});

	it("re-resolves dynamic headers on retry so a refreshed token is sent", async () => {
		let tokenVersion = 0;
		const getHeaders = jest.fn(() => ({
			authorization: `Bearer token-${++tokenVersion}`,
		}));

		const capturedHeaders: Record<string, string>[] = [];
		const client = jest
			.fn()
			.mockImplementationOnce((_url: string, init: RequestInit) => {
				capturedHeaders.push(init.headers as Record<string, string>);
				return Promise.resolve({
					status: "failed",
					error: { name: "Expired", message: "Token expired" },
				});
			})
			.mockImplementationOnce((_url: string, init: RequestInit) => {
				capturedHeaders.push(init.headers as Record<string, string>);
				return Promise.resolve({ status: "success", data: "retried" });
			});

		const onError = jest.fn().mockResolvedValue(true);
		const useHook = createValyn({ client, options: { headers: getHeaders, onError } });
		const [, cleanup] = withSetup(() =>
			useHook("/api/dyn-v2", { cache: false }),
		);

		await flushPromises();

		expect(getHeaders.mock.calls.length).toBeGreaterThanOrEqual(2);
		expect(capturedHeaders[1]["authorization"]).not.toBe(
			capturedHeaders[0]["authorization"],
		);
		cleanup();
	});

	it("passes files through to the client as FormData", async () => {
		let capturedInit: RequestInit | undefined;
		const client = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
			capturedInit = init;
			return Promise.resolve({ status: "success", data: "ok" });
		});

		const useHook = createValyn({ client });
		const file = new File(["bytes"], "report.pdf");
		const [composable, cleanup] = withSetup(() =>
			useHook("/api/upload-v5", { fetchOnMount: false }),
		);
		const [, fetchFn] = composable;

		fetchFn({ method: "POST", files: [["report", file]] });
		await flushPromises();

		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("report")).toBe(file);
		cleanup();
	});
});
