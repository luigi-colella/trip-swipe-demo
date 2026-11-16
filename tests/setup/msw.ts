import { afterAll, afterEach, beforeAll } from "vitest";
import { server } from "../helpers/msw";

// Any request without a handler fails the test: tests never touch the real network.
beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => server.resetHandlers());
afterAll(() => server.close());
