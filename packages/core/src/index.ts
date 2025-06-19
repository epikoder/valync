// core.ts — core abstractions shared across frameworks
import { Option, Some, None } from "ts-results-es";

// Type for cache key
export type CacheKey = string | Record<string, any>;

// Normalize cache key (convert object to stable string)
export function normalizeKey(key: CacheKey): string {
    return typeof key === "string" ? key : JSON.stringify(key);
}

// API Response standardization
export type ApiResponse<T> =
    | { status: "success"; data: T }
    | {
          status: "failed";
          error: { name: string; message: string; code?: number | string };
      };

// Base abstract class for async state
export abstract class AsyncValue<T> {
    abstract when<R>(handlers: {
        loading: () => R;
        error: (err: { name: string; message: string; code?: number }) => R;
        data: (value: Option<T>) => R;
    }): R;

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
    when<R>(h: any): R {
        return h.loading();
    }
}

// Represents failed state with error
export class AsyncError<T> extends AsyncValue<T> {
    constructor(
        public error: { name: string; message: string; code?: string | number },
    ) {
        super();
    }
    when<R>(h: any): R {
        return h.error(this.error);
    }
}

// Represents data state—with Some(T) or None
export class AsyncData<T> extends AsyncValue<T> {
    constructor(public value: Option<T>) {
        super();
    }
    when<R>(h: any): R {
        return h.data(this.value);
    }
}
