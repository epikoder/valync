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
        () => void,
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
                        if (res.status == "failed") {
                            setState(new AsyncError(res.error));
                            options.onError && options.onError(res.error);
                            return;
                        }

                        const data: T = options.onData
                            ? options.onData(res.data)
                            : res.data;
                        options.onSuccess && options.onSuccess(data);
                        const sd = new AsyncData(Some(data));
                        if (options.cache !== false) cache.set(keyStr, sd);
                        setState(sd);
                    })
                    .catch((err) => {
                        if (ctrl.signal.aborted) return;
                        if (tries > 0) return attempt(tries - 1);
                        options.onError &&
                            options.onError({
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

export function useValync<T>(
    key: CacheKey,
    options: ValyncOptions<T> = {},
): [
    AsyncValue<T>,
    () => void,
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
                        options.onError &&
                            options.onError({
                                name: "ParseError",
                                message: "Invalid JSON",
                            });
                        return {
                            status: "failed",
                            error: {
                                name: "ParseError",
                                message: "Invalid JSON",
                            },
                        };
                    }
                    if (!resp.ok || json.status === "failed") {
                        options.onError &&
                            options.onError(
                                json?.error ?? {
                                    name: "HttpError",
                                    message: resp.statusText,
                                    code: resp.status,
                                },
                            );
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
                        options.onError && options.onError(res.error);
                        setState(new AsyncError(res.error));
                    } else {
                        const data = options.onData
                            ? options.onData(res.data)
                            : res.data;
                        const sd = new AsyncData(Some(data));
                        options.onSuccess && options.onSuccess(data);
                        if (options.cache !== false) cache.set(keyStr, sd);
                        setState(sd);
                    }
                })
                .catch((err) => {
                    if (ctrl.signal.aborted) return;
                    if (tries > 0) return attempt(tries - 1);
                    options.onError &&
                        options.onError({
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
