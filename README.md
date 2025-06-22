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

#### Npm

```bash
npm i valync
```

#### yarn

```bash
yarn add valync
```

#### Bun

```bash
bun add valync
```

---

## API Overview

### `useValync<T>(key, options?)`

A hook/composable to fetch and manage async data.

- `key: string | Record<string, any>` — Unique cache key or URL.
- `options?`:

```ts
{
  init?: Omit<RequestInit, "signal">; // Pass request options for default client or custom client
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
import { useValync, AsyncValue } from "@epikoder/valync-react";

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

```tsx
const [state, onLogin] = useValync("/api/auth", {
    cache: false,
    fetchOnMount: false,
    init: {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password }),
    },
});
```

### Vue 3

```tsx
import { useValync, AsyncValue } from "@epikoder/valync-vue";
import { computed } from "vue";

export default {
    setup() {
        const [state, refetch] = useValync("/api/user/123", {
            fetchOnMount: true,
        });

        const userDisplay = computed(() =>
            state.when({
                loading: () => "Loading...",
                error: (e) => `Error: ${e.message}`,
                data: (opt) => (opt.some ? `${opt.val.name}` : "No user"),
            }),
        );

        return { userDisplay, refetch };
    },
};
```

for use within template you can use `state.isLoading()`, `state.isData()` and `state.isError()`.

### For more usage check the examples
[React demo counter](https://github.com/epikoder/valync/tree/main/examples/valync-react-demo)

[Vue demo counter](https://github.com/epikoder/valync/tree/main/examples/valync-vue-demo)

## Axios or other HTTP client

```tsx
import axios from "axios";
import { createValyn } from "valync/react";

const useAxiosValync = createValyn({
    client: async (url, init) =>
        await axios({ url, ...init }).then((res) => res.data), // transforms to data
});

// use in a component
const [state, refetch, setData] = useAxiosValync<User>("/api/user", {
    onData: (data) => {
        // transform data to User if needed
        return data;
    },
});
```

## ☕️ Buy Me a Drink

If this project saved you time, helped you ship faster, or made you say "damn, that's slick!" — consider buying me a beer 🍻

👉 [Send me a drink on Cointr.ee](https://cointr.ee/epikoder)
