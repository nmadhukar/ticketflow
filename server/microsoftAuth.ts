import { Express } from "express";
import passport from "passport";
import { OIDCStrategy, IProfile, VerifyCallback } from "passport-azure-ad";
import { storage } from "./storage";
import { getSession } from "./auth";

interface MicrosoftProfile extends IProfile {
  _json: {
    preferred_username?: string;
    name?: string;
    given_name?: string;
    family_name?: string;
    email?: string;
  };
}

export async function setupMicrosoftAuth(app: Express) {
  // Use the same session configuration as Replit auth
  if (!app.get("microsoftAuthConfigured")) {
    app.use(getSession());
    app.use(passport.initialize());
    app.use(passport.session());
    app.set("microsoftAuthConfigured", true);
  }

  // First check database for SSO configuration
  const ssoConfig = await storage.getSsoConfiguration();

  // Use database config if available, otherwise fall back to environment variables
  const clientId = ssoConfig?.clientId || process.env.MICROSOFT_CLIENT_ID;
  const clientSecret =
    ssoConfig?.clientSecret || process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = ssoConfig?.tenantId || process.env.MICROSOFT_TENANT_ID;

  const isMicrosoftConfigured = clientId && clientSecret && tenantId;

  if (!isMicrosoftConfigured) {
    if (!ssoConfig) {
      console.log(
        "Microsoft authentication not configured. Configure in Admin Panel or set environment variables."
      );
    }

    // Register routes that return configuration error
    app.get("/api/auth/microsoft", async (req, res) => {
      // Re-check database in case config was added after server start
      const latestConfig = await storage.getSsoConfiguration();
      if (
        latestConfig?.clientId &&
        latestConfig?.clientSecret &&
        latestConfig?.tenantId
      ) {
        // Config now exists, restart server would be needed
        res.status(503).json({
          message:
            "Microsoft authentication configuration has been updated. Please restart the server to apply changes.",
        });
      } else {
        res.status(503).json({
          message:
            "Microsoft authentication is not configured. Please contact your administrator to set up Microsoft 365 SSO.",
        });
      }
    });

    app.post("/api/auth/microsoft/callback", (req, res) => {
      res.status(503).json({
        message: "Microsoft authentication is not configured.",
      });
    });

    return;
  }

  const redirectUrl =
    process.env.MICROSOFT_REDIRECT_URL ||
    "http://localhost:5000/api/auth/microsoft/callback";

  console.log("Microsoft Auth Configuration:");
  console.log("- Client ID:", clientId);
  console.log("- Tenant ID:", tenantId);
  console.log("- Redirect URL:", redirectUrl);

  const config = {
    identityMetadata: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
    clientID: clientId,
    responseType: "code",
    responseMode: "form_post",
    redirectUrl: redirectUrl,
    allowHttpForRedirectUrl: true, // Allow HTTP in dev
    clientSecret: clientSecret,
    validateIssuer: false, // Disable issuer validation for debugging
    passReqToCallback: false,
    scope: ["profile", "email", "offline_access", "User.Read"],
    loggingLevel: "info", // Changed to info for better debugging
    nonceLifetime: 240,
    nonceMaxAmount: 5,
    useCookieInsteadOfSession: false,
    cookieSameSite: true,
    clockSkew: 300, // Allow 5 minutes clock skew
    audience: clientId, // Add audience to match client ID
  };

  const verify = async (
    iss: string,
    sub: string,
    profile: MicrosoftProfile,
    accessToken: string,
    refreshToken: string,
    done: VerifyCallback
  ) => {
    try {
      const email = profile._json.email || profile._json.preferred_username;
      const firstName = profile._json.given_name || profile.name?.givenName;
      const lastName = profile._json.family_name || profile.name?.familyName;

      // Create or update user
      const userData = {
        id: `ms_${sub}`, // Prefix Microsoft users
        email: email || "",
        firstName: firstName || null,
        lastName: lastName || null,
        profileImageUrl: null,
      };

      await storage.upsertUser(userData);

      // Create session user object
      const user = {
        claims: {
          sub: userData.id,
          email: userData.email,
          first_name: userData.firstName,
          last_name: userData.lastName,
          profile_image_url: userData.profileImageUrl,
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        },
        access_token: accessToken,
        refresh_token: refreshToken,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
        authProvider: "microsoft",
      };

      return done(null, user);
    } catch (error) {
      return done(error as Error);
    }
  };

  passport.use(
    "azuread-openidconnect",
    new OIDCStrategy(config as any, verify)
  );

  // Log the authentication URL for debugging
  const authUrl = `https://login.microsoftonline.com/${tenantId}/oauth2/v2.0/authorize?client_id=${clientId}&redirect_uri=${encodeURIComponent(
    redirectUrl
  )}&response_type=code&scope=openid%20profile%20email%20offline_access%20User.Read`;
  console.log("Microsoft Auth URL would be:", authUrl);

  // Serialize/deserialize user (shared with Replit auth)
  if (!passport.serializeUser.length) {
    passport.serializeUser((user: Express.User, cb) => cb(null, user));
    passport.deserializeUser((user: Express.User, cb) => cb(null, user));
  }

  // Microsoft login route
  app.get("/api/auth/microsoft", (req, res, next) => {
    console.log("Microsoft login initiated");
    console.log("Request host:", req.get("host"));
    console.log("Request protocol:", req.protocol);
    console.log(
      "Full URL:",
      `${req.protocol}://${req.get("host")}${req.originalUrl}`
    );

    try {
      passport.authenticate("azuread-openidconnect", {
        failureRedirect: "/auth?error=microsoft_auth_failed",
        failureMessage: true,
      })(req, res, next);
    } catch (error) {
      console.error("Error during Microsoft authentication:", error);
      res.redirect("/auth?error=microsoft_auth_error");
    }
  });

  // Microsoft callback route - handle both GET and POST
  const handleCallback = (req: any, res: any, next: any) => {
    console.log("Microsoft callback received");
    console.log("Callback method:", req.method);
    console.log("Callback body:", req.body);

    passport.authenticate(
      "azuread-openidconnect",
      {
        failureRedirect: "/auth?error=microsoft_auth_failed",
        failureMessage: true,
      },
      (err: any, user: any) => {
        if (err) {
          console.error("Microsoft auth error:", err);
          return res.redirect("/auth?error=microsoft_auth_error");
        }
        if (!user) {
          console.error("Microsoft auth: No user returned");
          return res.redirect("/auth?error=microsoft_no_user");
        }
        req.logIn(user, (loginErr: any) => {
          if (loginErr) {
            console.error("Login error:", loginErr);
            return res.redirect("/auth?error=login_failed");
          }
          // Successful authentication
          res.redirect("/");
        });
      }
    )(req, res, next);
  };

  app.get("/api/auth/microsoft/callback", handleCallback);
  app.post("/api/auth/microsoft/callback", handleCallback);

  console.log("Microsoft authentication configured successfully");
}

// Helper function to check if user is authenticated via Microsoft
export function isMicrosoftUser(user: any): boolean {
  return (
    user?.authProvider === "microsoft" || user?.claims?.sub?.startsWith("ms_")
  );
}
