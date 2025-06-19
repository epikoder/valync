import { AsyncData, AsyncError, AsyncLoading } from "../src/index";
import { Some } from "ts-results-es";

describe("AsyncValue", () => {
    it("wraps data correctly", () => {
        const result = new AsyncData(Some(123));
        expect(result.isData()).toBe(true);
        expect(result.value.unwrap()).toBe(123);
    });

    it("represents loading state", () => {
        const loading = new AsyncLoading();
        expect(loading.isLoading()).toBe(true);
    });

    it("represents error state", () => {
        const error = new AsyncError({
            name: "NetworkError",
            message: "Something went wrong",
            code: "500",
        });
        expect(error.isError()).toBe(true);
        expect(error.error.message).toBe("Something went wrong");
    });
});
