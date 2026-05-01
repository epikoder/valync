// core.ts — core abstractions shared across frameworks
import { Option } from "ts-results-es";

export type RequestBody = BodyInit | Record<string, unknown>;

export type ValyncOptions<T> = {
	init?: Omit<RequestInit, "signal">;
	files?: File[] | [string, File][];
	cache?: boolean;
	fetchOnMount?: boolean;
	retryCount?: number;
	onData?: (data: any) => T;
	watch?: any[];
	initialData?: ApiResponse<T>;
	fetchInterval?: number;
	onSuccess?: (data: T) => void;
	onError?: (err: ApiErrorResponse["error"]) => void;
};

// Type for cache key
export type CacheKey =
	| string
	| ({
			url: string;
	  } & Record<string, any>);

// Normalize cache key (convert object to stable string)
export function normalizeKey(key: CacheKey): string {
	if (typeof key === "string") return key;

	const { url, ...params } = key;
	const search = new URLSearchParams(params as Record<string, string>);
	return `${url}?${search.toString()}`;
}

// API Response standardization
export type ApiErrorResponse = {
	status: "failed";
	error: { name: string; message: string; code?: number | string };
};

export type ApiSuccessResponse<T> = {
	status: "success";
	data: T;
};

export type ApiResponse<T> = ApiSuccessResponse<T> | ApiErrorResponse;
export type Handler<T, R> = {
	loading?: () => R;
	error?: (err: { name: string; message: string; code?: number | string }) => R;
	data?: (value: Option<T>) => R;
};

export type RequestMethod = "GET" | "POST" | "PUT" | "DELETE" | "PATCH";

// --- Listener support ---
export type StateListener<T> = (val: AsyncValue<T>) => void;
export interface Observer<T> {
	listen: (fn: StateListener<T>) => () => void;
}

export class AsyncObserver<T> {
	constructor(private _current: AsyncValue<T>) {}
	private listeners = new Set<(val: AsyncValue<T>) => void>();

	public listen(fn: StateListener<T>) {
		fn(this._current);
		this.listeners.add(fn);
		return () => this.listeners.delete(fn);
	}

	public observer() {
		return {
			listen: (fn: StateListener<T>) => {
				this.listeners.add(fn);
				return () => this.listeners.delete(fn);
			},
		};
	}

	public set(val: AsyncValue<T>) {
		this._current = val;
		this.listeners.forEach((fn) => fn(val));
	}
}

// Base abstract class for async state
export abstract class AsyncValue<T> {
	abstract when<R>(handlers: Handler<T, R>): R;

	isLoading(): this is AsyncLoading {
		return this instanceof AsyncLoading;
	}

	isData(): this is AsyncData<T> {
		return this instanceof AsyncData;
	}

	isError(): this is AsyncError {
		return this instanceof AsyncError;
	}
}

// Represents loading state
export class AsyncLoading<T = unknown> extends AsyncValue<T> {
	when<R>(h: Handler<T, R>): R {
		return h.loading ? h.loading() : undefined;
	}
}

// Represents failed state with error
export class AsyncError<T = unknown> extends AsyncValue<T> {
	constructor(
		public error: { name: string; message: string; code?: string | number },
	) {
		super();
	}
	when<R>(h: Handler<T, R>): R {
		return h.error ? h.error(this.error) : undefined;
	}
}

// Represents data state—with Some(T) or None
export class AsyncData<T> extends AsyncValue<T> {
	constructor(public value: Option<T>) {
		super();
	}
	when<R>(h: Handler<T, R>): R {
		return h.data ? h.data(this.value) : undefined;
	}
}

function isPlainObject(v: unknown): v is Record<string, unknown> {
	if (v === null || typeof v !== "object") return false;
	if (v instanceof Blob) return false;
	if (v instanceof FormData) return false;
	if (v instanceof URLSearchParams) return false;
	if (v instanceof ArrayBuffer) return false;
	if (typeof ReadableStream !== "undefined" && v instanceof ReadableStream)
		return false;
	return true;
}

export function buildRequestBody(
	body?: RequestBody | null,
	files?: File[] | [string, File][],
): { body: BodyInit | null | undefined; isMultipart: boolean } {
	if (files?.length) {
		const fd = body instanceof FormData ? body : new FormData();
		if (body && !(body instanceof FormData) && isPlainObject(body)) {
			for (const [k, v] of Object.entries(body)) {
				fd.append(k, String(v));
			}
		}
		for (const file of files) {
			if (Array.isArray(file)) {
				fd.append(file[0], file[1]);
			} else {
				fd.append("file", file as File);
			}
		}
		return { body: fd, isMultipart: true };
	}

	if (body instanceof FormData) {
		return { body, isMultipart: true };
	}

	if (isPlainObject(body)) {
		return { body: JSON.stringify(body), isMultipart: false };
	}

	return { body: body as BodyInit | null | undefined, isMultipart: false };
}

export function mergeHeaders(
	base?: HeadersInit,
	extra?: HeadersInit,
): Record<string, string> {
	const result: Record<string, string> = {};
	const append = (h?: HeadersInit) => {
		if (!h) return;
		if (h instanceof Headers) {
			h.forEach((v, k) => (result[k] = v));
		} else if (Array.isArray(h)) {
			for (const [k, v] of h) result[k] = v;
		} else {
			Object.assign(result, h);
		}
	};
	append(base);
	append(extra);
	return result;
}
