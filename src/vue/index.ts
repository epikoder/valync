import { ref, onMounted, watch, Ref, onUnmounted } from "vue";
import { Some, None } from "ts-results-es";
import {
    normalizeKey,
    ApiResponse,
    AsyncValue,
    AsyncLoading,
    AsyncError,
    AsyncData,
    ValyncOptions,
    Listenable,
    AsyncObserver,
} from "../core";

const cache = new Map<string, AsyncData<any>>();

export type ValyncVueOptions<T> = Omit<ValyncOptions<T>, "init"> & {
    init?: Ref<RequestInit>;
};
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
    return function <T>(
        key: string | Record<string, any>,
        options: ValyncVueOptions<T> = {},
    ): [
        Ref<AsyncValue<T>>,
        () => void,
        (updater: (prev: T | null) => T) => void,
        Listenable<T>,
    ] {
        let intervalId: number | undefined;
        const initRef = options.init ?? ref<RequestInit>({});
        initRef.value = {
            ...initRef.value,
            headers: { ...initRef.value.headers, ..._options.headers },
        };
        options.init.value = {
            ...options.init.value,
            headers: { ...options.init.value.headers, ..._options.headers },
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
            typeof window !== "undefined" &&
            typeof AbortController !== "undefined";

        const doFetch = () => {
            controller.value?.abort();
            controller.value = new AbortController();

            if (options.cache !== false && cache.has(keyStr)) {
                state.value = cache.get(keyStr)!;
                return;
            }

            state.value = new AsyncLoading<T>();

            const attempt = (tries: number) => {
                client(typeof key === "string" ? key : keyStr, {
                    ...options.init.value,
                    signal: controller.value!.signal,
                })
                    .then((res) => {
                        if (controller.value!.signal.aborted) return;
                        if (res.status === "failed")
                            state.value = new AsyncError(res.error);
                        else {
                            const data = options.onData
                                ? options.onData(res.data)
                                : res.data;
                            const sd = new AsyncData(Some(data));
                            if (options.cache !== false) cache.set(keyStr, sd);
                            state.value = sd;
                        }
                    })
                    .catch((err) => {
                        if (controller.value!.signal.aborted) return;
                        if (tries > 0) return attempt(tries - 1);
                        state.value = new AsyncError({
                            name: "NetworkError",
                            message: err.message,
                            code: "500",
                        });
                    });
            };

            attempt(options.retryCount ?? 0);
        };

        if (isClient) {
            onMounted(() => {
                if (options.fetchOnMount !== false && !options.initialData) {
                    doFetch();
                }

                if (options.fetchInterval) {
                    intervalId = window.setInterval(
                        doFetch,
                        options.fetchInterval,
                    );
                }
            });

            onUnmounted(() => {
                controller.value?.abort();
                if (intervalId) clearInterval(intervalId);
            });
        }

        if (isClient && options.watch && options.watch.length > 0) {
            watch(() => options.watch, doFetch);
        }

        watch(state, () => {
            observerRef.value.set(state.value);
        });

        const refetch = () => {
            if (isClient) doFetch();
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

        return [
            state,
            refetch,
            setData,
            observerRef.value.listenable(),
        ] as const;
    };
}

export function useValync<T>(
    key: string | Record<string, any>,
    options: ValyncVueOptions<T> = {},
) {
    let intervalId: number | undefined;
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

    const observer = ref(new AsyncObserver(initialValue));
    const state = ref<AsyncValue<T>>(initialValue);

    const isClient =
        typeof window !== "undefined" && typeof AbortController !== "undefined";

    const doFetch = () => {
        controller.value?.abort();
        controller.value = new AbortController();

        if (options.cache !== false && cache.has(keyStr)) {
            state.value = cache.get(keyStr)!;
            return;
        }

        state.value = new AsyncLoading<T>();

        const attempt = (tries: number) => {
            fetch(typeof key === "string" ? key : keyStr, {
                ...options.init.value,
                signal: controller.value!.signal,
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
                    if (controller.value!.signal.aborted) return;
                    if (res.status === "failed")
                        state.value = new AsyncError(res.error);
                    else {
                        const data = options.onData
                            ? options.onData(res.data)
                            : res.data;
                        const sd = new AsyncData(Some(data));
                        if (options.cache !== false) cache.set(keyStr, sd);
                        state.value = sd;
                    }
                })
                .catch((err) => {
                    if (controller.value!.signal.aborted) return;
                    if (tries > 0) return attempt(tries - 1);
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
            if (options.fetchOnMount !== false && !options.initialData) {
                doFetch();
            }

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
        watch(() => options.watch, doFetch);
    }

    watch(state, () => {
        observer.value.set(state.value);
    });

    const refetch = () => {
        if (isClient) doFetch();
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

    return [state, refetch, setData, observer.value.listenable()] as const;
}
