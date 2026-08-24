import { describe, expect, it, vi } from "vitest";
import { getWeatherData, weatherInputSchema } from "@/lib/ai/tools/get-weather";

function jsonResponse(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), { status });
}

function fetchSequence(...responses: Response[]) {
  return vi.fn<typeof fetch>().mockImplementation(() => {
    const response = responses.shift();
    if (!response) {
      return Promise.reject(new Error("Unexpected fetch"));
    }
    return Promise.resolve(response);
  });
}

function weatherResponse() {
  return {
    current: {
      interval: 900,
      temperature_2m: 21,
      time: "2026-07-24T12:00",
    },
    current_units: {
      interval: "seconds",
      temperature_2m: "°C",
      time: "iso8601",
    },
    daily: {
      sunrise: ["2026-07-24T05:00"],
      sunset: ["2026-07-24T21:00"],
      time: ["2026-07-24"],
    },
    daily_units: {
      sunrise: "iso8601",
      sunset: "iso8601",
      time: "iso8601",
    },
    elevation: 34,
    generationtime_ms: 0.1,
    hourly: {
      temperature_2m: [21],
      time: ["2026-07-24T12:00"],
    },
    hourly_units: {
      temperature_2m: "°C",
      time: "iso8601",
    },
    latitude: 52.52,
    longitude: 13.405,
    timezone: "Europe/Berlin",
    timezone_abbreviation: "CEST",
    utc_offset_seconds: 7200,
  };
}

describe("weatherInputSchema", () => {
  it("accepts a city or a complete coordinate pair", () => {
    expect(weatherInputSchema.parse({ city: " Berlin " })).toEqual({
      city: "Berlin",
    });
    expect(
      weatherInputSchema.parse({ latitude: 52.52, longitude: 13.405 })
    ).toEqual({ latitude: 52.52, longitude: 13.405 });
  });

  it("rejects incomplete, out-of-range, and oversized locations", () => {
    expect(() => weatherInputSchema.parse({ latitude: 52.52 })).toThrow();
    expect(() =>
      weatherInputSchema.parse({ latitude: 91, longitude: 13.405 })
    ).toThrow();
    expect(() => weatherInputSchema.parse({ city: "x".repeat(101) })).toThrow();
  });
});

describe("getWeatherData", () => {
  it("geocodes a city and returns its weather with the city name", async () => {
    const fetchImpl = fetchSequence(
      jsonResponse({
        results: [{ latitude: 52.52, longitude: 13.405 }],
      }),
      jsonResponse(weatherResponse())
    );

    await expect(
      getWeatherData({ city: "Berlin" }, { fetchImpl, timeoutMs: 1000 })
    ).resolves.toEqual({
      ...weatherResponse(),
      cityName: "Berlin",
    });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
    expect(fetchImpl.mock.calls[0]?.[0].toString()).toContain("name=Berlin");
    expect(fetchImpl.mock.calls[1]?.[0].toString()).toContain(
      "latitude=52.52&longitude=13.405"
    );
  });

  it("uses coordinates without making a geocoding request", async () => {
    const fetchImpl = fetchSequence(jsonResponse(weatherResponse()));

    await expect(
      getWeatherData(
        { latitude: 48.137, longitude: 11.575 },
        { fetchImpl, timeoutMs: 1000 }
      )
    ).resolves.toEqual(weatherResponse());
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(fetchImpl.mock.calls[0]?.[1]?.signal).toBeInstanceOf(AbortSignal);
  });

  it("returns a useful error for an upstream HTTP failure", async () => {
    const fetchImpl = fetchSequence(jsonResponse({}, 503));

    await expect(
      getWeatherData(
        { latitude: 48.137, longitude: 11.575 },
        { fetchImpl, timeoutMs: 1000 }
      )
    ).resolves.toEqual({
      error: "Weather service request failed (503). Try again.",
    });
  });

  it("returns a useful error for invalid upstream JSON", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response("not json", { status: 200 }));

    await expect(
      getWeatherData(
        { latitude: 48.137, longitude: 11.575 },
        { fetchImpl, timeoutMs: 1000 }
      )
    ).resolves.toEqual({
      error: "Weather service could not be reached. Try again.",
    });
  });

  it("returns a useful error for malformed upstream weather data", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ current: { temperature_2m: 21 } }));

    await expect(
      getWeatherData(
        { latitude: 48.137, longitude: 11.575 },
        { fetchImpl, timeoutMs: 1000 }
      )
    ).resolves.toEqual({
      error: "Weather service returned an invalid response. Try again.",
    });
  });

  it("aborts a hung upstream request at the shared deadline", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );

    await expect(
      getWeatherData(
        { latitude: 48.137, longitude: 11.575 },
        { fetchImpl, timeoutMs: 10 }
      )
    ).resolves.toEqual({
      error: "Weather service timed out. Try again.",
    });
  });

  it("propagates client cancellation instead of masking it", async () => {
    const controller = new AbortController();
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(
      (_input, init) =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener(
            "abort",
            () => reject(new DOMException("Aborted", "AbortError")),
            { once: true }
          );
        })
    );
    const result = getWeatherData(
      { latitude: 48.137, longitude: 11.575 },
      { abortSignal: controller.signal, fetchImpl, timeoutMs: 1000 }
    );

    controller.abort();
    await expect(result).rejects.toMatchObject({ name: "AbortError" });
  });
});
