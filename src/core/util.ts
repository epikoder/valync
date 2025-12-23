import { ApiResponse } from ".";

export const DefaultValyncClient = <T>(url: string, init: RequestInit) =>
	fetch(url, init).then(async (resp): Promise<ApiResponse<T>> => {
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
				(json.status !== "success" && json.status !== "failed"))
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
	});
