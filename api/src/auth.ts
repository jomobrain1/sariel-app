import { createAuth } from "@tilcayo/auth";
import { storage } from "./storage.js";

import { sendPasswordResetCode } from "./password-reset-email.js";

export const auth = createAuth({
  tenancy: { baseDomain: process.env.TENANCY_BASE_DOMAIN || "localhost" },
  avatarStorage: storage,
  cookieSession: true,
  sendPasswordResetCode,
  accessTokenSecret: process.env.AUTH_ACCESS_SECRET ?? "",
  refreshTokenSecret: process.env.AUTH_REFRESH_SECRET ?? "",
});
