import { setDefaultAutoSelectFamilyAttemptTimeout } from "node:net";

// Node tries IPv6 and IPv4 in turn but gives each attempt only 250 ms by default. On slower or
// high-latency networks (and networks advertising a broken IPv6 route) that abandons a working
// IPv4 connection to MongoDB Atlas too early, so allow each attempt longer.
setDefaultAutoSelectFamilyAttemptTimeout(Number(process.env.NETWORK_ATTEMPT_TIMEOUT_MS ?? 2000));

const port = Number(process.env.PORT ?? 9149);
if (!Number.isInteger(port) || port < 0 || port > 65535) throw new Error("PORT must be an integer between 0 and 65535.");

export const config = {
  port,
  mongoUri: process.env.MONGODB_URI ?? "",
};
