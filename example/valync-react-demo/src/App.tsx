import { useState, useEffect } from "react";
import { createValyn } from "../../../src/react";
import "./App.css";
import { AsyncData, type ApiResponse } from "../../../src/core";

const valync = createValyn({
    client: async (_, init): Promise<ApiResponse<number>> => {
        await new Promise((r) => setTimeout(r, 500)); // simulate network delay
        const { count } = JSON.parse((init.body as string) ?? "{}");
        return { status: "success", data: count };
    },
    options: {
        cache: false,
    },
});

export default function App() {
    const [count, setCount] = useState(0);
    const [state, _, __, listener] = valync<number>("/api", {
        init: {
            body: JSON.stringify({ count }),
            headers: {
                "Content-Type": "application/json",
            },
        },
        fetchOnMount: true,
        watch: [count],
    });

    const onClick = () => {
        setCount(count + 1);
    };

    useEffect(() => {
        const unsubscribe = listener.listen((event) => {
            if (
                event.isData() &&
                event instanceof AsyncData &&
                event.value.isSome()
            ) {
                alert(event.value.unwrap());
            }
        });

        return () => {
            unsubscribe();
        };
    }, []);

    return (
        <div>
            {state.when({
                loading: () => <p>Loading...</p>,
                data: (d) =>
                    d.isSome() && (
                        <p
                            onClick={onClick}
                            style={{
                                color: "blue",
                                padding: "10px",
                                backgroundColor: "lightgray",
                                cursor: "pointer",
                            }}
                        >
                            Clicked: {d.unwrap()}
                        </p>
                    ),
                error: (e) => <p>Error: {e.message}</p>,
            })}
        </div>
    );
}
