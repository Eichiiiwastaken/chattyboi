import { tool } from "ai";
import { z } from "zod";

const WEATHER_REQUEST_TIMEOUT_MS = 15_000;

export const weatherInputSchema = z
  .object({
    city: z
      .string()
      .trim()
      .min(1)
      .max(100)
      .describe("City name (e.g., 'San Francisco', 'New York', 'London')")
      .optional(),
    latitude: z.number().finite().min(-90).max(90).optional(),
    longitude: z.number().finite().min(-180).max(180).optional(),
  })
  .refine(
    (input) =>
      Boolean(input.city) ||
      (input.latitude !== undefined && input.longitude !== undefined),
    {
      message:
        "Provide either a city name or both latitude and longitude coordinates.",
    }
  );

type WeatherInput = z.infer<typeof weatherInputSchema>;

const weatherResponseSchema = z.object({
  current: z.object({
    interval: z.number(),
    temperature_2m: z.number(),
    time: z.string(),
  }),
  current_units: z.object({
    interval: z.string(),
    temperature_2m: z.string(),
    time: z.string(),
  }),
  daily: z.object({
    sunrise: z.array(z.string()),
    sunset: z.array(z.string()),
    time: z.array(z.string()),
  }),
  daily_units: z.object({
    sunrise: z.string(),
    sunset: z.string(),
    time: z.string(),
  }),
  elevation: z.number(),
  generationtime_ms: z.number(),
  hourly: z.object({
    temperature_2m: z.array(z.number()),
    time: z.array(z.string()),
  }),
  hourly_units: z.object({
    temperature_2m: z.string(),
    time: z.string(),
  }),
  latitude: z.number(),
  longitude: z.number(),
  timezone: z.string(),
  timezone_abbreviation: z.string(),
  utc_offset_seconds: z.number(),
});

export type WeatherAtLocation = z.infer<typeof weatherResponseSchema> & {
  cityName?: string;
};

export type WeatherResult = WeatherAtLocation | { error: string };

interface WeatherRequestOptions {
  abortSignal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

type Coordinates = {
  latitude: number;
  longitude: number;
};

function isCoordinates(value: unknown): value is Coordinates {
  if (!(value && typeof value === "object")) {
    return false;
  }

  const latitude = Reflect.get(value, "latitude");
  const longitude = Reflect.get(value, "longitude");
  return (
    typeof latitude === "number" &&
    Number.isFinite(latitude) &&
    latitude >= -90 &&
    latitude <= 90 &&
    typeof longitude === "number" &&
    Number.isFinite(longitude) &&
    longitude >= -180 &&
    longitude <= 180
  );
}

async function geocodeCity(
  city: string,
  fetchImpl: typeof fetch,
  signal: AbortSignal
): Promise<Coordinates | null> {
  const response = await fetchImpl(
    `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1&language=en&format=json`,
    { signal }
  );

  if (!response.ok) {
    return null;
  }

  const data: unknown = await response.json();
  if (!(data && typeof data === "object")) {
    return null;
  }

  const results = Reflect.get(data, "results");
  const firstResult = Array.isArray(results) ? results[0] : undefined;
  return isCoordinates(firstResult) ? firstResult : null;
}

export async function getWeatherData(
  input: WeatherInput,
  {
    abortSignal,
    fetchImpl = fetch,
    timeoutMs = WEATHER_REQUEST_TIMEOUT_MS,
  }: WeatherRequestOptions = {}
): Promise<WeatherResult> {
  const timeoutController = new AbortController();
  let timedOut = false;
  const timeout = globalThis.setTimeout(() => {
    timedOut = true;
    timeoutController.abort();
  }, timeoutMs);
  const signal = abortSignal
    ? AbortSignal.any([abortSignal, timeoutController.signal])
    : timeoutController.signal;

  try {
    let coordinates: Coordinates;
    if (input.city) {
      const geocoded = await geocodeCity(input.city, fetchImpl, signal);
      if (!geocoded) {
        return {
          error: `Could not find coordinates for "${input.city}". Check the city name.`,
        };
      }
      coordinates = geocoded;
    } else if (input.latitude !== undefined && input.longitude !== undefined) {
      coordinates = {
        latitude: input.latitude,
        longitude: input.longitude,
      };
    } else {
      return {
        error:
          "Provide either a city name or both latitude and longitude coordinates.",
      };
    }

    const response = await fetchImpl(
      `https://api.open-meteo.com/v1/forecast?latitude=${coordinates.latitude}&longitude=${coordinates.longitude}&current=temperature_2m&hourly=temperature_2m&daily=sunrise,sunset&timezone=auto`,
      { signal }
    );
    if (!response.ok) {
      return {
        error: `Weather service request failed (${response.status}). Try again.`,
      };
    }

    const weatherData = weatherResponseSchema.safeParse(await response.json());
    if (!weatherData.success) {
      return {
        error: "Weather service returned an invalid response. Try again.",
      };
    }

    return input.city
      ? { ...weatherData.data, cityName: input.city }
      : weatherData.data;
  } catch (error) {
    if (abortSignal?.aborted) {
      throw error;
    }
    return {
      error: timedOut
        ? "Weather service timed out. Try again."
        : "Weather service could not be reached. Try again.",
    };
  } finally {
    globalThis.clearTimeout(timeout);
  }
}

export const getWeather = tool({
  description:
    "Get the current weather at a location. You can provide either coordinates or a city name.",
  inputSchema: weatherInputSchema,
  execute: async (input, { abortSignal }) =>
    getWeatherData(input, { abortSignal }),
});
