import { useEffect, useRef, useState } from "react";
import { Some, None } from "ts-results-es";
import {
	normalizeKey,
	ApiResponse,
	AsyncValue,
	AsyncLoading,
	AsyncError,
	AsyncData,
	ValyncOptions,
	Observer,
	AsyncObserver,
	CacheKey,
	RequestMethod,
	RequestBody,
	buildRequestBody,
	mergeHeaders,
} from "../core/index";

const cache = new Map<string, AsyncData<any>>();

export type CreateValynOptions = Pick<
	ValyncOptions<any>,
	"cache" | "retryCount" | "fetchOnMount"
> & {
	headers?: HeadersInit | (() => HeadersInit);
	onError?: (err: {
		name: string;
		message: string;
		code?: number | string;
	}) => boolean | Promise<boolean>;
};

/**
 * createValyn creates a custom `useValync` hook bound to a provided HTTP client function.
 * Useful for plugging in your own fetch logic or a library like axios.
 *
 * The `options.onError` callback receives every API-level error. Returning `true` (or a
 * Promise resolving to `true`) triggers a single retry — useful for token-refresh flows.
 *
 * ⚠️ NOTE:
 * Your `client()` function MUST return a Promise resolving to:
 *
 *    ApiResponse<any>
 *
 *    {
 *      status: "success" | "failed",
 *      data?: T,
 *      error?: { name: string; message: string; code?: number }
 *    }
 *
 * use `onData` to apply transformation from `any => T` for individual endpoints when necessary.
 */
export function createValyn({
	client,
	options: _options = {},
}: {
	client: (url: string, init: RequestInit) => Promise<ApiResponse<any>>;
	options?: CreateValynOptions;
}) {
	return function useValynHook<T>(
		key: CacheKey,
		options: ValyncOptions<T> = {},
	): [
		AsyncValue<T>,
		(
			methodOrOpts?:
				| RequestMethod
				| {
						method?: RequestMethod;
						body?: RequestBody;
						files?: File[] | [string, File][];
				  },
			body?: RequestBody,
			files?: File[] | [string, File][],
		) => void,
		(updater: (prev: T | null) => T) => void,
		Observer<T>,
	] {
		const resolvedGlobalHeaders =
			typeof _options.headers === "function"
				? _options.headers()
				: _options.headers;

		options.init = {
			...options.init,
			headers: mergeHeaders(options.init?.headers, resolvedGlobalHeaders),
		};
		options.cache = options.cache ?? _options.cache;
		options.retryCount = options.retryCount ?? _options.retryCount;
		options.fetchOnMount = options.fetchOnMount ?? _options.fetchOnMount;

		const keyStr = normalizeKey(key);
		const controllerRef = useRef<AbortController>(null);

		const observerRef = useRef(new AsyncObserver<T>(new AsyncData<T>(None)));
		const [state, setState] = useState<AsyncValue<T>>((): AsyncValue<T> => {
			if (options.initialData) {
				return options.initialData.status === "success"
					? new AsyncData(Some(options.initialData.data))
					: new AsyncError<T>(options.initialData.error);
			}
			if (options.cache !== false && cache.has(keyStr)) {
				return cache.get(keyStr)!;
			}
			return new AsyncData<T>(None);
		});

		const isClient =
			typeof window !== "undefined" && typeof AbortController !== "undefined";

		const doFetch = (
			method?: RequestMethod,
			body?: RequestBody,
			files?: File[] | [string, File][],
		) => {
			controllerRef.current?.abort();
			const ctrl = new AbortController();
			controllerRef.current = ctrl;

			if (options.cache !== false && cache.has(keyStr)) {
				setState(cache.get(keyStr)!);
				return;
			}

			setState(new AsyncLoading<T>());

			const resolvedFiles = files ?? options.files;
			const { body: resolvedBody, isMultipart } = buildRequestBody(
				body ?? (options.init?.body as RequestBody | undefined),
				resolvedFiles,
			);

			let globalRetryDone = false;

			const attempt = (tries: number) => {
				// Re-resolve dynamic global headers on every attempt (supports token refresh)
				const freshGlobalHeaders =
					typeof _options.headers === "function"
						? _options.headers()
						: _options.headers;
				const merged = mergeHeaders(options.init?.headers, freshGlobalHeaders);
				if (!isMultipart && resolvedBody != null && !("content-type" in merged)) {
					merged["content-type"] = "application/json";
				}

				client(typeof key === "string" ? key : keyStr, {
					...options.init,
					method:
						method ??
						options.init?.method ??
						(resolvedBody != null ? "POST" : "GET"),
					body: resolvedBody,
					headers: merged,
					signal: ctrl.signal,
				})
					.then(async (res) => {
						if (ctrl.signal.aborted) return;

						if (
							process.env.NODE_ENV !== "production" &&
							(typeof res !== "object" ||
								!("status" in res) ||
								(res.status !== "success" && res.status !== "failed"))
						) {
							console.warn(
								`[Valync] Expected ApiResponse<T> format missing from client() response. Got:`,
								res,
							);
						}

						if (res.status === "failed") {
							if (_options.onError && !globalRetryDone) {
								const shouldRetry = await _options.onError(res.error);
								if (shouldRetry && !ctrl.signal.aborted) {
									globalRetryDone = true;
									attempt(0);
									return;
								}
							}
							setState(new AsyncError(res.error));
							options.onError?.(res.error);
							return;
						}

						const data = options.onData?.(res.data) ?? res.data;
						options.onSuccess?.(data);
						const sd = new AsyncData(Some(data));
						if (options.cache !== false) cache.set(keyStr, sd);
						setState(sd);
					})
					.catch((err) => {
						if (ctrl.signal.aborted) return;
						if (tries > 0) return attempt(tries - 1);
						options.onError?.({ name: "NetworkError", message: err.message });
						setState(
							new AsyncError({ name: "NetworkError", message: err.message }),
						);
					});
			};

			attempt(options.retryCount ?? 0);
		};

		useEffect(() => {
			if (!isClient || options.initialData) return;
			if (options.fetchOnMount !== false) doFetch();
			return () => controllerRef.current?.abort();
		}, [keyStr]);

		useEffect(() => {
			observerRef.current.set(state);
		}, [state]);

		useEffect(() => {
			if (!options.watch) return;
			if (isClient) doFetch();
		}, [...(options.watch ?? [])]);

		useEffect(() => {
			if (!options.fetchInterval || !isClient) return;
			const intervalId = setInterval(doFetch, options.fetchInterval);
			return () => clearInterval(intervalId);
		}, [options.fetchInterval, isClient]);

		const fetchFn = (
			methodOrOpts?:
				| RequestMethod
				| {
						method?: RequestMethod;
						body?: RequestBody;
						files?: File[] | [string, File][];
				  },
			body?: RequestBody,
			files?: File[] | [string, File][],
		) => {
			if (!isClient) return;
			cache.delete(normalizeKey(keyStr));
			if (typeof methodOrOpts === "string") {
				doFetch(methodOrOpts, body, files);
			} else {
				doFetch(methodOrOpts?.method, methodOrOpts?.body, methodOrOpts?.files);
			}
		};

		const setData = (updater: (prev: T | null) => T) => {
			setState((prev) => {
				if (!(prev instanceof AsyncData)) return prev;
				const current = prev.value.isSome() ? prev.value.unwrap() : null;
				const updated = updater(current);
				const newData = new AsyncData(Some(updated));
				if (options.cache !== false) cache.set(keyStr, newData);
				return newData;
			});
		};

		return [state, fetchFn, setData, observerRef.current.observer()];
	};
}

/**
 * useValync is a client-side data fetching hook that provides async state management
 * with caching, optimistic updates, and reactive watching support.
 *
 * ⚠️ NOTE:
 * Your server MUST return a JSON response of the shape:
 *
 *    ApiResponse<T> | ApiResponse<any>
 *
 *    {
 *      status: "success" | "failed",
 *      data?: T,
 *      error?: { name: string; message: string; code?: number }
 *    }
 *
 * Use `onData` if `res.data` does not match your expected frontend type or if you wish to
 * apply transformation. Returning a plain array or object without the `status` field will
 * cause issues.
 */
export function useValync<T>(
	key: CacheKey,
	options: ValyncOptions<T> = {},
): [
	AsyncValue<T>,
	(
		methodOrOpts?:
			| RequestMethod
			| {
					method?: RequestMethod;
					body?: RequestBody;
					files?: File[] | [string, File][];
			  },
		body?: RequestBody,
		files?: File[] | [string, File][],
	) => void,
	(updater: (prev: T | null) => T) => void,
	Observer<T>,
] {
	const keyStr = normalizeKey(key);
	const controllerRef = useRef<AbortController>(null);

	const observerRef = useRef(new AsyncObserver<T>(new AsyncData<T>(None)));
	const [state, setState] = useState<AsyncValue<T>>(() => {
		if (options.initialData) {
			return options.initialData.status === "success"
				? new AsyncData(Some(options.initialData.data))
				: new AsyncError(options.initialData.error);
		}
		if (options.cache !== false && cache.has(keyStr)) {
			return cache.get(keyStr)!;
		}
		return new AsyncData<T>(None);
	});

	const isClient =
		typeof window !== "undefined" && typeof AbortController !== "undefined";

	const doFetch = (
		method?: RequestMethod,
		body?: RequestBody,
		files?: File[] | [string, File][],
	) => {
		controllerRef.current?.abort();
		const ctrl = new AbortController();
		controllerRef.current = ctrl;

		if (options.cache !== false && cache.has(keyStr)) {
			setState(cache.get(keyStr)!);
			return;
		}

		setState(new AsyncLoading<T>());

		const resolvedFiles = files ?? options.files;
		const { body: resolvedBody, isMultipart } = buildRequestBody(
			body ?? (options.init?.body as RequestBody | undefined),
			resolvedFiles,
		);

		const buildHeaders = (): Record<string, string> => {
			const h = mergeHeaders(options.init?.headers);
			if (!isMultipart && resolvedBody != null && !("content-type" in h)) {
				h["content-type"] = "application/json";
			}
			return h;
		};

		const attempt = (tries: number) => {
			fetch(typeof key === "string" ? key : keyStr, {
				...options.init,
				method:
					method ??
					options.init?.method ??
					(resolvedBody != null ? "POST" : "GET"),
				body: resolvedBody,
				headers: buildHeaders(),
				signal: ctrl.signal,
			})
				.then(async (resp): Promise<ApiResponse<T>> => {
					if (resp.status === 204) {
						return { status: "success", data: null as unknown as T };
					}

					let json: any;
					try {
						json = await resp.json();
					} catch {
						return {
							status: "failed",
							error: {
								name: "ParseError",
								message: "Invalid JSON",
								code: resp.status,
							},
						};
					}

					if (
						process.env.NODE_ENV !== "production" &&
						(typeof json !== "object" ||
							!("status" in json) ||
							(json.status !== "success" && json.status !== "failed"))
					) {
						console.warn(
							`[Valync] Expected ApiResponse<T> format missing. Got:`,
							json,
						);
					}

					if (!resp.ok || json.status === "failed") {
						return {
							status: "failed",
							error: json?.error ?? {
								name: "HttpError",
								message: resp.statusText,
								code: resp.status,
							},
						};
					}

					return json;
				})
				.then((res) => {
					if (ctrl.signal.aborted) return;
					if (res.status === "failed") {
						options.onError?.(res.error);
						setState(new AsyncError(res.error));
					} else {
						const data = options.onData?.(res.data) ?? res.data;
						const sd = new AsyncData(Some(data));
						options.onSuccess?.(data);
						if (options.cache !== false) cache.set(keyStr, sd);
						setState(sd);
					}
				})
				.catch((err) => {
					if (ctrl.signal.aborted) return;
					if (tries > 0) return attempt(tries - 1);
					setState(
						new AsyncError({ name: "NetworkError", message: err.message }),
					);
					options.onError?.({ name: "NetworkError", message: err.message });
				});
		};

		attempt(options.retryCount ?? 0);
	};

	useEffect(() => {
		if (!isClient || options.initialData) return;
		if (options.fetchOnMount !== false) doFetch();
		return () => controllerRef.current?.abort();
	}, [keyStr]);

	useEffect(() => {
		observerRef.current.set(state);
	}, [state]);

	useEffect(() => {
		if (!options.watch) return;
		if (isClient) doFetch();
	}, [...(options.watch ?? [])]);

	useEffect(() => {
		if (!options.fetchInterval || !isClient) return;
		const intervalId = setInterval(doFetch, options.fetchInterval);
		return () => clearInterval(intervalId);
	}, [options.fetchInterval, isClient]);

	const fetchFn = (
		methodOrOpts?:
			| RequestMethod
			| {
					method?: RequestMethod;
					body?: RequestBody;
					files?: File[] | [string, File][];
			  },
		body?: RequestBody,
		files?: File[] | [string, File][],
	) => {
		if (!isClient) return;
		cache.delete(normalizeKey(keyStr));
		if (typeof methodOrOpts === "string") {
			doFetch(methodOrOpts, body, files);
		} else {
			doFetch(methodOrOpts?.method, methodOrOpts?.body, methodOrOpts?.files);
		}
	};

	const setData = (updater: (prev: T | null) => T) => {
		setState((prev) => {
			if (!(prev instanceof AsyncData)) return prev;
			const current = prev.value.isSome() ? prev.value.unwrap() : null;
			const updated = updater(current);
			const newData = new AsyncData(Some(updated));
			if (options.cache !== false) cache.set(keyStr, newData);
			return newData;
		});
	};

	return [state, fetchFn, setData, observerRef.current.observer()];
}
