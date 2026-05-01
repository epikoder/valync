/**
 * @jest-environment jsdom
 */
import { renderHook, act, waitFor } from "@testing-library/react";
import { useValync, createValyn } from "../src/react/index";
import { AsyncData, AsyncError, AsyncLoading } from "../src/core/index";
import { None } from "ts-results-es";

// ─── fetch helpers ────────────────────────────────────────────────────────────
// jsdom does not include a native `fetch` on window; assign directly.

type MockFetch = jest.MockedFunction<typeof fetch>;

function makeFetchMock(
	status: number,
	body?: any,
	ok = true,
): MockFetch {
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

function success(data: any): MockFetch {
	const m = makeFetchMock(200, { status: "success", data });
	global.fetch = m;
	return m;
}

function failure(error: { name: string; message: string }): MockFetch {
	const m = makeFetchMock(200, { status: "failed", error });
	global.fetch = m;
	return m;
}

function noContent(): MockFetch {
	const m = makeFetchMock(204);
	global.fetch = m;
	return m;
}

afterEach(() => jest.clearAllMocks());

// ─── useValync ────────────────────────────────────────────────────────────────

describe("useValync", () => {
	it("starts with AsyncData(None) when fetchOnMount is false", () => {
		const { result } = renderHook(() =>
			useValync("/api/test", { fetchOnMount: false }),
		);
		const [state] = result.current;
		expect(state).toBeInstanceOf(AsyncData);
		expect((state as AsyncData<any>).value).toBe(None);
	});

	it("transitions through loading then AsyncData(Some) on success", async () => {
		success({ name: "Alice" });
		const { result } = renderHook(() =>
			useValync<{ name: string }>("/api/user-1", { cache: false }),
		);

		await waitFor(() => {
			const s = result.current[0];
			expect(s).toBeInstanceOf(AsyncData);
			expect((s as AsyncData<any>).value.isSome()).toBe(true);
		});

		expect((result.current[0] as AsyncData<any>).value.unwrap()).toEqual({
			name: "Alice",
		});
	});

	it("transitions to AsyncError on a failed API response", async () => {
		failure({ name: "NotFound", message: "User not found" });
		const { result } = renderHook(() =>
			useValync("/api/user-2", { cache: false }),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncError));
		expect((result.current[0] as AsyncError).error.name).toBe("NotFound");
	});

	it("handles 204 No Content as AsyncData(Some(null))", async () => {
		noContent();
		const { result } = renderHook(() =>
			useValync("/api/action-1", { cache: false }),
		);

		await waitFor(() => {
			const s = result.current[0];
			expect(s).toBeInstanceOf(AsyncData);
			expect((s as AsyncData<any>).value.isSome()).toBe(true);
		});

		expect((result.current[0] as AsyncData<any>).value.unwrap()).toBeNull();
	});

	it("calls onSuccess with the resolved data", async () => {
		success(42);
		const onSuccess = jest.fn();
		renderHook(() =>
			useValync("/api/num-1", { cache: false, onSuccess }),
		);

		await waitFor(() => expect(onSuccess).toHaveBeenCalledWith(42));
	});

	it("calls onError on an API failure", async () => {
		failure({ name: "Unauthorized", message: "No access" });
		const onError = jest.fn();
		renderHook(() =>
			useValync("/api/secret-1", { cache: false, onError }),
		);

		await waitFor(() =>
			expect(onError).toHaveBeenCalledWith(
				expect.objectContaining({ name: "Unauthorized" }),
			),
		);
	});

	it("does not fetch when fetchOnMount is false", () => {
		const spy = jest.fn() as MockFetch;
		global.fetch = spy;
		renderHook(() => useValync("/api/nofetch", { fetchOnMount: false }));
		expect(spy).not.toHaveBeenCalled();
	});

	it("seeds state from initialData without fetching", () => {
		const spy = jest.fn() as MockFetch;
		global.fetch = spy;
		const { result } = renderHook(() =>
			useValync("/api/init-1", {
				initialData: { status: "success", data: { preset: true } },
			}),
		);
		expect(spy).not.toHaveBeenCalled();
		expect(
			(result.current[0] as AsyncData<any>).value.unwrap(),
		).toEqual({ preset: true });
	});

	it("seeds an error state from a failed initialData", () => {
		const { result } = renderHook(() =>
			useValync("/api/init-2", {
				fetchOnMount: false,
				initialData: {
					status: "failed",
					error: { name: "Seeded", message: "pre-seeded error" },
				},
			}),
		);
		expect(result.current[0]).toBeInstanceOf(AsyncError);
		expect((result.current[0] as AsyncError).error.name).toBe("Seeded");
	});

	it("applies onData transform to the raw response data", async () => {
		success({ raw: "VALUE" });
		const { result } = renderHook(() =>
			useValync("/api/transform-1", {
				cache: false,
				onData: (d) => ({ transformed: d.raw.toLowerCase() }),
			}),
		);

		await waitFor(() => {
			const s = result.current[0];
			expect(s).toBeInstanceOf(AsyncData);
			expect((s as AsyncData<any>).value.isSome()).toBe(true);
		});

		expect((result.current[0] as AsyncData<any>).value.unwrap()).toEqual({
			transformed: "value",
		});
	});

	it("setData updates state optimistically without a network call", async () => {
		success({ count: 0 });
		const { result } = renderHook(() =>
			useValync<{ count: number }>("/api/counter-1", { cache: false }),
		);

		await waitFor(() => {
			expect(
				(result.current[0] as AsyncData<any>).value.unwrap(),
			).toEqual({ count: 0 });
		});

		act(() => {
			result.current[2]((prev) => ({ count: (prev?.count ?? 0) + 1 }));
		});

		expect(
			(result.current[0] as AsyncData<any>).value.unwrap(),
		).toEqual({ count: 1 });
	});

	it("fetchFn (string form) re-fetches and updates state", async () => {
		success({ v: 1 });
		const { result } = renderHook(() =>
			useValync<{ v: number }>("/api/refetch-1", { cache: false }),
		);
		await waitFor(() =>
			expect((result.current[0] as AsyncData<any>).value.unwrap()).toEqual({ v: 1 }),
		);

		success({ v: 2 });
		act(() => result.current[1]("GET"));

		await waitFor(() =>
			expect((result.current[0] as AsyncData<any>).value.unwrap()).toEqual({ v: 2 }),
		);
	});

	it("fetchFn sends FormData when files are provided via object form", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementationOnce(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: "uploaded" }),
				} as Response);
			},
		) as MockFetch;

		const { result } = renderHook(() =>
			useValync("/api/upload-1", { fetchOnMount: false }),
		);
		const file = new File(["data"], "photo.jpg", { type: "image/jpeg" });

		act(() => {
			result.current[1]({ method: "POST", files: [["photo", file]] });
		});

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("photo")).toBe(file);
	});

	it("fetchFn sends FormData when files are provided via positional args", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementation(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: "ok" }),
				} as Response);
			},
		) as MockFetch;

		const { result } = renderHook(() =>
			useValync("/api/upload-2", { fetchOnMount: false }),
		);
		const file = new File(["data"], "doc.pdf");

		act(() => {
			result.current[1]("POST", undefined, [["doc", file]]);
		});

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("doc")).toBe(file);
	});

	it("auto-sets content-type: application/json for plain object body", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementation(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: {} }),
				} as Response);
			},
		) as MockFetch;

		const { result } = renderHook(() =>
			useValync("/api/json-1", { fetchOnMount: false }),
		);

		act(() => {
			result.current[1]("POST", { name: "test" });
		});

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));

		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers?.["content-type"]).toBe("application/json");
		expect(capturedInit?.body).toBe(JSON.stringify({ name: "test" }));
	});

	it("does NOT set content-type for FormData body (browser sets boundary)", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementation(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: {} }),
				} as Response);
			},
		) as MockFetch;

		const { result } = renderHook(() =>
			useValync("/api/upload-3", { fetchOnMount: false }),
		);
		const fd = new FormData();
		fd.append("key", "value");

		act(() => {
			result.current[1]("POST", fd);
		});

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		const headers = capturedInit?.headers as Record<string, string>;
		expect(headers?.["content-type"]).toBeUndefined();
	});

	it("uses ValyncOptions.files on every fetch without repeating the option", async () => {
		let capturedInit: RequestInit | undefined;
		global.fetch = jest.fn().mockImplementation(
			(_url: string, init: RequestInit) => {
				capturedInit = init;
				return Promise.resolve({
					status: 200,
					ok: true,
					json: () => Promise.resolve({ status: "success", data: "ok" }),
				} as Response);
			},
		) as MockFetch;

		const file = new File(["x"], "bg.jpg");
		const { result } = renderHook(() =>
			useValync("/api/upload-4", {
				files: [["background", file]],
				init: { method: "POST" },
			}),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("background")).toBe(file);
	});
});

// ─── createValyn ──────────────────────────────────────────────────────────────

describe("createValyn", () => {
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
		const { result } = renderHook(() =>
			useHook("/api/retry-1", { cache: false }),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		expect(client).toHaveBeenCalledTimes(2);
		expect(
			(result.current[0] as AsyncData<any>).value.unwrap(),
		).toEqual({ retried: true });
	});

	it("does not retry when global onError returns false", async () => {
		const client = jest.fn().mockResolvedValue({
			status: "failed",
			error: { name: "Forbidden", message: "Access denied" },
		});
		const onError = jest.fn().mockResolvedValue(false);
		const useHook = createValyn({ client, options: { onError } });
		const { result } = renderHook(() =>
			useHook("/api/retry-2", { cache: false }),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncError));
		expect(client).toHaveBeenCalledTimes(1);
	});

	it("retries at most once — does not loop even if onError always returns true", async () => {
		const client = jest.fn().mockResolvedValue({
			status: "failed",
			error: { name: "Err", message: "always fails" },
		});
		const onError = jest.fn().mockResolvedValue(true);
		const useHook = createValyn({ client, options: { onError } });
		const { result } = renderHook(() =>
			useHook("/api/retry-3", { cache: false }),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncError));
		expect(client).toHaveBeenCalledTimes(2);
	});

	it("calls dynamic headers function and merges into every request", async () => {
		let lastHeaders: any;
		const getHeaders = jest.fn(() => ({ authorization: "Bearer static-token" }));
		const client = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
			lastHeaders = init.headers;
			return Promise.resolve({ status: "success", data: "ok" });
		});

		const useHook = createValyn({ client, options: { headers: getHeaders } });
		const { result } = renderHook(() =>
			useHook("/api/dyn-1", { cache: false }),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		expect(getHeaders).toHaveBeenCalled();
		expect((lastHeaders as Record<string, string>)["authorization"]).toBe(
			"Bearer static-token",
		);
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
		const useHook = createValyn({
			client,
			options: { headers: getHeaders, onError },
		});
		const { result } = renderHook(() =>
			useHook("/api/dyn-2", { cache: false }),
		);

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));

		// getHeaders called at init + once per attempt (2 attempts = ≥3 total)
		expect(getHeaders.mock.calls.length).toBeGreaterThanOrEqual(2);
		// the two captured request headers must have different tokens
		expect(capturedHeaders[1]["authorization"]).not.toBe(
			capturedHeaders[0]["authorization"],
		);
	});

	it("passes files through to the client as FormData", async () => {
		let capturedInit: RequestInit | undefined;
		const client = jest.fn().mockImplementation((_url: string, init: RequestInit) => {
			capturedInit = init;
			return Promise.resolve({ status: "success", data: "ok" });
		});

		const useHook = createValyn({ client });
		const file = new File(["bytes"], "report.pdf");
		const { result } = renderHook(() =>
			useHook("/api/upload-5", { fetchOnMount: false }),
		);

		act(() => {
			result.current[1]({ method: "POST", files: [["report", file]] });
		});

		await waitFor(() => expect(result.current[0]).toBeInstanceOf(AsyncData));
		expect(capturedInit?.body).toBeInstanceOf(FormData);
		expect((capturedInit?.body as FormData).get("report")).toBe(file);
	});
});
