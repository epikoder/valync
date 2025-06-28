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
} from "../core";

const cache = new Map<string, AsyncData<any>>();

/**
 * createValyn creates a custom `useValync` hook bound to a provided HTTP client function.
 * Useful for plugging in your own fetch logic or a library like axios.
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
 * use `onData` to apply transformation from `any => T` for individual endpoint when neccessary.
 * Returning a plain array or object without the `status` field will cause issues.
 */

export function createValyn({
    client,
    options: _options = {},
}: {
    client: (url: string, init: RequestInit) => Promise<ApiResponse<any>>;
    options?: Pick<
        ValyncOptions<any>,
        "cache" | "retryCount" | "fetchOnMount"
    > & { headers?: HeadersInit };
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
                      body?: BodyInit;
                  },
            body?: BodyInit,
        ) => void,
        (updater: (prev: T | null) => T) => void,
        Observer<T>,
    ] {
        options.init = options.init || {};
        options.init = {
            ...options.init,
            headers: { ...options.init.headers, ..._options.headers },
        };
        options.cache = options.cache ?? _options.cache;
        options.retryCount = options.retryCount ?? _options.retryCount;
        options.fetchOnMount = options.fetchOnMount ?? _options.fetchOnMount;

        const keyStr = normalizeKey(key);
        const controllerRef = useRef<AbortController>(null);

        const observerRef = useRef(
            new AsyncObserver<T>(new AsyncData<T>(None)),
        );
        const [state, setState] = useState<AsyncValue<T>>((): AsyncValue<T> => {
            if (options.initialData) {
                const initialData =
                    options.initialData.status === "success"
                        ? new AsyncData(Some(options.initialData.data))
                        : new AsyncError<T>(options.initialData.error);
                return initialData;
            }
            if (options.cache !== false && cache.has(keyStr)) {
                return cache.get(keyStr)!;
            }
            return new AsyncData<T>(None);
        });

        const isClient =
            typeof window !== "undefined" &&
            typeof AbortController !== "undefined";

        const doFetch = (method?: RequestMethod, body?: BodyInit) => {
            controllerRef.current?.abort();
            const ctrl = new AbortController();
            controllerRef.current = ctrl;

            if (options.cache !== false && cache.has(keyStr)) {
                setState(cache.get(keyStr)!);
                return;
            }

            setState(new AsyncLoading<T>());

            const attempt = (tries: number) => {
                client(typeof key === "string" ? key : keyStr, {
                    ...options.init,
                    method:
                        method ??
                        options.init?.method ??
                        (body ? "POST" : "GET"),
                    body: body ?? options.init?.body,
                    signal: ctrl.signal,
                })
                    .then((res) => {
                        if (ctrl.signal.aborted) return;

                        // DEV-ONLY: Validate ApiResponse<T> shape
                        if (
                            process.env.NODE_ENV !== "production" &&
                            (typeof res !== "object" ||
                                !("status" in res) ||
                                (res.status !== "success" &&
                                    res.status !== "failed"))
                        ) {
                            console.warn(
                                `[Valync] Expected ApiResponse<T> format missing from client() response. Got:`,
                                res,
                            );
                        }

                        if (res.status === "failed") {
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
                        options.onError?.({
                            name: "NetworkError",
                            message: err.message,
                        });
                        setState(
                            new AsyncError({
                                name: "NetworkError",
                                message: err.message,
                            }),
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
                | { method?: RequestMethod; body?: BodyInit },
            body?: BodyInit,
        ) => {
            if (!isClient) return;

            cache.delete(normalizeKey(keyStr));
            if (typeof methodOrOpts === "string") {
                doFetch(methodOrOpts, body);
            } else {
                doFetch(methodOrOpts?.method, methodOrOpts?.body);
            }
        };

        const setData = (updater: (prev: T | null) => T) => {
            setState((prev) => {
                if (!(prev instanceof AsyncData)) return prev;
                const current = prev.value.isSome()
                    ? prev.value.unwrap()
                    : null;
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
 * Use `onData` if `res.data` does not match your expected frontend type or if you wish to apply transformation,
 * so returning a plain array or object without the `status` field will cause issues.
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
                  body?: BodyInit;
              },
        body?: BodyInit,
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

    const doFetch = (method?: RequestMethod, body?: BodyInit) => {
        controllerRef.current?.abort();
        const ctrl = new AbortController();
        controllerRef.current = ctrl;

        if (options.cache !== false && cache.has(keyStr)) {
            setState(cache.get(keyStr)!);
            return;
        }

        setState(new AsyncLoading<T>());

        const attempt = (tries: number) => {
            fetch(typeof key === "string" ? key : keyStr, {
                ...options.init,
                method:
                    method ?? options.init?.method ?? (body ? "POST" : "GET"),
                body: body ?? options.init?.body,
                signal: ctrl.signal,
            })
                .then(async (resp): Promise<ApiResponse<T>> => {
                    let json: any;
                    try {
                        json = await resp.json();
                    } catch {
                        return {
                            status: "failed",
                            error: {
                                name: "ParseError",
                                message: "Invalid JSON",
                            },
                        };
                    }

                    // DEV-ONLY: Validate ApiResponse format
                    if (
                        process.env.NODE_ENV !== "production" &&
                        (typeof json !== "object" ||
                            !("status" in json) ||
                            (json.status !== "success" &&
                                json.status !== "failed"))
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
                        new AsyncError({
                            name: "NetworkError",
                            message: err.message,
                        }),
                    );
                    options.onError?.({
                        name: "NetworkError",
                        message: err.message,
                    });
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
            | { method?: RequestMethod; body?: BodyInit },
        body?: BodyInit,
    ) => {
        if (!isClient) return;

        cache.delete(normalizeKey(keyStr));
        if (typeof methodOrOpts === "string") {
            doFetch(methodOrOpts, body);
        } else {
            doFetch(methodOrOpts?.method, methodOrOpts?.body);
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
