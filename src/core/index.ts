// core.ts — core abstractions shared across frameworks
import { Option } from "ts-results-es";

export type ValyncOptions<T> = {
    init?: Omit<RequestInit, "signal">;
    cache?: boolean;
    fetchOnMount?: boolean;
    retryCount?: number;
    onData?: (data: T) => T;
    watch?: any[];
    initialData?: ApiResponse<T>;
};

// Type for cache key
export type CacheKey = string | Record<string, any>;

// Normalize cache key (convert object to stable string)
export function normalizeKey(key: CacheKey): string {
    return typeof key === "string" ? key : JSON.stringify(key);
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
    error?: (err: {
        name: string;
        message: string;
        code?: number | string;
    }) => R;
    data?: (value: Option<T>) => R;
};

// Base abstract class for async stZte
export abstract class AsyncValue<T> {
    abstract when<R>(handlers: Handler<T, R>): R;

    isLoading() {
        return this instanceof AsyncLoading;
    }

    isData() {
        return this instanceof AsyncData;
    }

    isError() {
        return this instanceof AsyncError;
    }
}

// Represents loading state
export class AsyncLoading<T> extends AsyncValue<T> {
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
