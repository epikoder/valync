import { ref, shallowRef, onMounted, watch, Ref, onUnmounted } from "vue";
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

export type ValyncVueOptions<T> = Omit<ValyncOptions<T>, "init"> & {
	init?: Ref<RequestInit>;
};

export type CreateValynVueOptions = Pick<
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
 * createValyn creates a custom `useValync` composable bound to a provided HTTP client function.
 * Useful for plugging in your own fetch logic or a library like axios.
 *
 * The `options.onError` callback receives every API-level error. Returning `true` (or a
 * Promise resolving to `true`) triggers a single retry — useful for token-refresh flows.
 *
 * ⚠️ NOTE:
 * Your `client()` function MUST return a Promise resolving to ApiResponse<any>.
 */
export function createValyn({
	client,
	options: _options = {},
}: {
	client: (url: string, init: RequestInit) => Promise<ApiResponse<any>>;
	options?: CreateValynVueOptions;
}) {
	return function <T>(
		key: CacheKey,
		options: ValyncVueOptions<T> = {},
	): [
		Ref<AsyncValue<T>>,
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
		let intervalId: number | undefined;

		const initRef: Ref<RequestInit> = options.init ?? shallowRef({} as RequestInit);
		const resolvedGlobalHeaders =
			typeof _options.headers === "function"
				? _options.headers()
				: _options.headers;
		initRef.value = {
			...initRef.value,
			headers: mergeHeaders(initRef.value.headers, resolvedGlobalHeaders),
		};

		options.cache = options.cache ?? _options.cache;
		options.retryCount = options.retryCount ?? _options.retryCount;
		options.fetchOnMount = options.fetchOnMount ?? _options.fetchOnMount;

		const keyStr = normalizeKey(key);
		const controller = ref<AbortController>();

		let initialValue: AsyncValue<T>;
		if (options.initialData) {
			initialValue =
				options.initialData.status === "success"
					? new AsyncData(Some(options.initialData.data))
					: new AsyncError(options.initialData.error);
		} else if (options.cache !== false && cache.has(keyStr)) {
			initialValue = cache.get(keyStr)!;
		} else {
			initialValue = new AsyncData<T>(None);
		}

		const observerRef = ref(new AsyncObserver(initialValue));
		const state = ref<AsyncValue<T>>(initialValue);

		const isClient =
			typeof window !== "undefined" && typeof AbortController !== "undefined";

		const doFetch = (
			method?: RequestMethod,
			body?: RequestBody,
			files?: File[] | [string, File][],
		) => {
			controller.value?.abort();
			controller.value = new AbortController();

			if (options.cache !== false && cache.has(keyStr)) {
				state.value = cache.get(keyStr)!;
				return;
			}

			state.value = new AsyncLoading<T>();

			const resolvedFiles = files ?? options.files;
			const { body: resolvedBody, isMultipart } = buildRequestBody(
				body ?? (initRef.value?.body as RequestBody | undefined),
				resolvedFiles,
			);

			let globalRetryDone = false;

			const attempt = (tries: number) => {
				// Re-resolve dynamic global headers on every attempt (supports token refresh)
				const freshGlobalHeaders =
					typeof _options.headers === "function"
						? _options.headers()
						: _options.headers;
				const merged = mergeHeaders(initRef.value?.headers, freshGlobalHeaders);
				if (!isMultipart && resolvedBody != null && !("content-type" in merged)) {
					merged["content-type"] = "application/json";
				}

				client(typeof key === "string" ? key : keyStr, {
					...initRef.value,
					method:
						method ??
						initRef.value?.method ??
						(resolvedBody != null ? "POST" : "GET"),
					body: resolvedBody,
					headers: merged,
					signal: controller.value!.signal,
				})
					.then(async (res) => {
						if (controller.value!.signal.aborted) return;

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
								if (shouldRetry && !controller.value!.signal.aborted) {
									globalRetryDone = true;
									attempt(0);
									return;
								}
							}
							options.onError?.(res.error);
							state.value = new AsyncError(res.error);
							return;
						}

						const data = options.onData?.(res.data) ?? res.data;
						options.onSuccess?.(data);
						const sd = new AsyncData(Some(data));
						if (options.cache !== false) cache.set(keyStr, sd);
						state.value = sd;
					})
					.catch((err) => {
						if (controller.value!.signal.aborted) return;
						if (tries > 0) return attempt(tries - 1);
						options.onError?.({ name: "NetworkError", message: err.message });
						state.value = new AsyncError({
							name: "NetworkError",
							message: err.message,
						});
					});
			};

			attempt(options.retryCount ?? 0);
		};

		if (isClient) {
			onMounted(() => {
				if (options.fetchOnMount !== false && !options.initialData) doFetch();
				if (options.fetchInterval) {
					intervalId = window.setInterval(doFetch, options.fetchInterval);
				}
			});

			onUnmounted(() => {
				controller.value?.abort();
				if (intervalId) clearInterval(intervalId);
			});
		}

		if (isClient && options.watch && options.watch.length > 0) {
			watch(options.watch, () => doFetch());
		}

		watch(state, () => {
			observerRef.value.set(state.value);
		});

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
			const currentVal =
				state.value instanceof AsyncData
					? state.value.value.isSome()
						? state.value.value.unwrap()
						: null
					: null;
			const newVal = new AsyncData(Some(updater(currentVal)));
			if (options.cache !== false) cache.set(keyStr, newVal);
			state.value = newVal;
		};

		return [state, fetchFn, setData, observerRef.value.observer()] as const;
	};
}

/**
 * useValync is a client-side data fetching composable that provides async state management
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
 */
export function useValync<T>(key: CacheKey, options: ValyncVueOptions<T> = {}) {
	let intervalId: number | undefined;
	const keyStr = normalizeKey(key);
	const controller = ref<AbortController>();

	const initRef: Ref<RequestInit> = options.init ?? shallowRef({} as RequestInit);

	let initialValue: AsyncValue<T>;
	if (options.initialData) {
		initialValue =
			options.initialData.status === "success"
				? new AsyncData(Some(options.initialData.data))
				: new AsyncError(options.initialData.error);
	} else if (options.cache !== false && cache.has(keyStr)) {
		initialValue = cache.get(keyStr)!;
	} else {
		initialValue = new AsyncData<T>(None);
	}

	const observer = ref(new AsyncObserver(initialValue));
	const state = ref<AsyncValue<T>>(initialValue);

	const isClient =
		typeof window !== "undefined" && typeof AbortController !== "undefined";

	const doFetch = (
		method?: RequestMethod,
		body?: RequestBody,
		files?: File[] | [string, File][],
	) => {
		controller.value?.abort();
		controller.value = new AbortController();

		if (options.cache !== false && cache.has(keyStr)) {
			state.value = cache.get(keyStr)!;
			return;
		}

		state.value = new AsyncLoading<T>();

		const resolvedFiles = files ?? options.files;
		const { body: resolvedBody, isMultipart } = buildRequestBody(
			body ?? (initRef.value?.body as RequestBody | undefined),
			resolvedFiles,
		);

		const buildHeaders = (): Record<string, string> => {
			const h = mergeHeaders(initRef.value?.headers);
			if (!isMultipart && resolvedBody != null && !("content-type" in h)) {
				h["content-type"] = "application/json";
			}
			return h;
		};

		const attempt = (tries: number) => {
			fetch(typeof key === "string" ? key : keyStr, {
				...initRef.value,
				method:
					method ??
					initRef.value?.method ??
					(resolvedBody != null ? "POST" : "GET"),
				body: resolvedBody,
				headers: buildHeaders(),
				signal: controller.value!.signal,
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
					if (controller.value!.signal.aborted) return;
					if (res.status === "failed") {
						options.onError?.(res.error);
						state.value = new AsyncError(res.error);
					} else {
						const data = options.onData?.(res.data) ?? res.data;
						options.onSuccess?.(data);
						const sd = new AsyncData(Some(data));
						if (options.cache !== false) cache.set(keyStr, sd);
						state.value = sd;
					}
				})
				.catch((err) => {
					if (controller.value!.signal.aborted) return;
					if (tries > 0) return attempt(tries - 1);
					options.onError?.({ name: "NetworkError", message: err.message });
					state.value = new AsyncError({
						name: "NetworkError",
						message: err.message,
					});
				});
		};

		attempt(options.retryCount ?? 0);
	};

	if (isClient) {
		onMounted(() => {
			if (options.fetchOnMount !== false && !options.initialData) doFetch();
			if (options.fetchInterval) {
				intervalId = window.setInterval(doFetch, options.fetchInterval);
			}
		});

		onUnmounted(() => {
			controller.value?.abort();
			if (intervalId) clearInterval(intervalId);
		});
	}

	if (isClient && options.watch && options.watch.length > 0) {
		watch(options.watch, () => doFetch());
	}

	watch(state, () => {
		observer.value.set(state.value);
	});

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
		const currentVal =
			state.value instanceof AsyncData
				? state.value.value.isSome()
					? state.value.value.unwrap()
					: null
				: null;
		const newVal = new AsyncData(Some(updater(currentVal)));
		if (options.cache !== false) cache.set(keyStr, newVal);
		state.value = newVal;
	};

	return [state, fetchFn, setData, observer.value.observer()] as const;
}
