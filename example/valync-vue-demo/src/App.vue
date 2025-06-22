<script setup lang="ts">
import { ref, onMounted, onUnmounted, computed } from "vue";
import { createValyn } from "../../../src/vue";
import { AsyncData, type ApiResponse } from "../../../src/core";

const count = ref(0);

const valync = createValyn({
    client: async (_, init): Promise<ApiResponse<number>> => {
        await new Promise((r) => setTimeout(r, 500));
        console.log(JSON.parse((init.body as string) ?? "{}"));
        const { count } = JSON.parse((init.body as string) ?? "{}");
        return { status: "success", data: count };
    },
    options: { cache: false },
});

const init = computed(() => ({
    body: JSON.stringify({ count: count.value }),
    headers: { "Content-Type": "application/json" },
}));

const [state, _, __, listener] = valync<number>("/api", {
    init: init,
    initialData: { status: "success", data: count.value },
    fetchOnMount: true,
    watch: [count],
});

const onClick = () => {
    console.log(init.value);
    count.value += 1;
};

onMounted(() => {
    const unsubscribe = listener.listen((event) => {
        if (event.isData() && event.value.isSome()) {
            // alert(event.value.unwrap());
        }
    });
    onUnmounted(() => unsubscribe());
});
</script>

<template>
    <div>
        <p v-if="state.isLoading()">Loading...</p>
        <p
            v-else-if="
                state.isData() && state.value.isSome() && state.value.isSome()
            "
            @click="onClick"
            style="
                color: blue;
                padding: 10px;
                background-color: lightgray;
                cursor: pointer;
            "
        >
            Clicked: {{ state.value.unwrap() }}
        </p>
        <p v-else-if="state.isError()">Error: {{ state.error.message }}</p>
    </div>
</template>

<style scoped>
p {
    font-family: sans-serif;
}
</style>
