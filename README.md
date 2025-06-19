# Valync

**A lightweight, framework-agnostic async data handling library for React & Vue, inspired by Riverpod’s AsyncValue pattern and powered by ts-results-es.**

---

## Features

- Unified async state with `AsyncLoading`, `AsyncError`, and `AsyncData` wrapping `Option<T>`
- Built-in caching with auto revalidation & manual refresh
- Supports React & Vue with idiomatic hooks/composables
- Reactive `watch` dependencies to refetch on data change
- `setData()` for manual or partial UI updates
- Uses a strict API response shape for uniform error & data handling

---

## Installation

#### React
```bash
pnpm add @valync/react @valync/core ts-results-es
```

#### Vue 3
```bash
pnpm add @valync/vue @valync/core ts-results-es
```

---

## API Overview

### `useValync<T>(key, options?)`

A hook/composable to fetch and manage async data.

- `key: string | Record<string, any>` — Unique cache key or URL.
- `options?`:

```ts
{
  cache?: boolean; // default true, enable/disable caching
  fetchOnMount?: boolean; // default true, fetch automatically on mount
  retryCount?: number; // retry count for failed requests
  onData?: (data: T) => T; // transform data before setting
  watch?: any[]; // reactive dependencies to trigger refetch
  initialData?: ApiResponse<T>; // initial server-side data for hydration
}
```
---

### Return tuple

```ts
const [state, refetch, setData] = useValync<T>(key, options);
```

## AsyncValue States

```ts
AsyncLoading<T>;
AsyncError<T>; // contains error { name, message, code? }
AsyncData<T>; // contains Option<T>: Some(value) or None
```
---

## Example usage

### React

```tsx
import { useValync, AsyncValue } from "@valync/react";

function UserProfile({ userId }: { userId: string }) {
    const [state, refetch] = useValync<{ name: string; age: number }>(
        `/api/user/${userId}`,
        {
            fetchOnMount: true,
            retryCount: 2,
        },
    );

    return state.when({
        loading: () => <div>Loading...</div>,
        error: (err) => <div>Error: {err.message}</div>,
        data: (opt) =>
            opt.some ? (
                <div>
                    {opt.val.name} ({opt.val.age} years old)
                </div>
            ) : (
                <div>No data available</div>
            ),
    });
}
```

### Vue 3

```tsx
import { useValync, AsyncValue } from "@valync/vue";
import { computed } from "vue";

export default {
    setup() {
        const [state, refetch] = useValync("/api/user/123", {
            fetchOnMount: true,
        });

        const userDisplay = computed(() =>
            state.value.when({
                loading: () => "Loading...",
                error: (e) => `Error: ${e.message}`,
                data: (opt) => (opt.some ? `${opt.val.name}` : "No user"),
            }),
        );

        return { userDisplay, refetch };
    },
};
```
