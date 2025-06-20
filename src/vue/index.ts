import { ref, onMounted, watch } from "vue";
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
                    ...options.init,
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

        if (
            isClient &&
            options.fetchOnMount !== false &&
            !options.initialData
        ) {
            onMounted(doFetch);
        }

        if (isClient && options.watch && options.watch.length > 0) {
            watch(options.watch, doFetch);
        }

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

        return [state.value, refetch, setData] as const;
    };
}

export function useValync<T>(
    key: string | Record<string, any>,
    options: ValyncOptions<T> = {},
) {
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
                ...options.init,
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

    if (isClient && options.fetchOnMount !== false && !options.initialData) {
        onMounted(doFetch);
    }

    if (isClient && options.watch && options.watch.length > 0) {
        watch(options.watch, doFetch);
    }

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

    return [state.value, refetch, setData] as const;
}
