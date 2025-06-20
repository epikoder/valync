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
} from "../core";

const cache = new Map<string, AsyncData<any>>();

export function createValyn({
    client,
}: {
    client: (url: string, init: RequestInit) => Promise<ApiResponse<any>>;
}) {
    return function <T>(
        key: string | Record<string, any>,
        options: ValyncOptions<T> = {},
    ): [AsyncValue<T>, () => void, (updater: (prev: T | null) => T) => void] {
        const keyStr = normalizeKey(key);
        const controllerRef = useRef<AbortController>(null);

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
            typeof window !== "undefined" &&
            typeof AbortController !== "undefined";

        const doFetch = () => {
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
                    signal: ctrl.signal,
                })
                    .then((res) => {
                        if (ctrl.signal.aborted) return;
                        if (res.status == "failed") {
                            setState(new AsyncError(res.error));
                            return;
                        }

                        const data: T = options.onData
                            ? options.onData(res.data)
                            : res.data;
                        const sd = new AsyncData(Some(data));
                        if (options.cache !== false) cache.set(keyStr, sd);
                        setState(sd);
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
                    });
            };

            attempt(options.retryCount ?? 0);
        };

        useEffect(() => {
            if (!isClient || options.initialData) return;
            if (options.fetchOnMount !== false) doFetch();
            return () => controllerRef.current?.abort();
        }, [keyStr]);

        if (options.watch) {
            useEffect(() => {
                if (isClient) doFetch();
            }, options.watch);
        }

        const refetch = () => {
            if (isClient) doFetch();
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

        return [state, refetch, setData];
    };
}

export function useValync<T>(
    key: string | Record<string, any>,
    options: ValyncOptions<T> = {},
): [AsyncValue<T>, () => void, (updater: (prev: T | null) => T) => void] {
    const keyStr = normalizeKey(key);
    const controllerRef = useRef<AbortController>(null);

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

    const doFetch = () => {
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
                    if (!resp.ok || json.status === "failed") {
                        return {
                            status: "failed",
                            error: json.error ?? {
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
                    if (res.status === "failed")
                        setState(new AsyncError(res.error));
                    else {
                        const data = options.onData
                            ? options.onData(res.data)
                            : res.data;
                        const sd = new AsyncData(Some(data));
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
                });
        };

        attempt(options.retryCount ?? 0);
    };

    useEffect(() => {
        if (!isClient || options.initialData) return;
        if (options.fetchOnMount !== false) doFetch();
        return () => controllerRef.current?.abort();
    }, [keyStr]);

    if (options.watch) {
        useEffect(() => {
            if (isClient) doFetch();
        }, options.watch);
    }

    const refetch = () => {
        if (isClient) doFetch();
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

    return [state, refetch, setData];
}
