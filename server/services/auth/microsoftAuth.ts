import { Express } from "express";
import passport from "passport";
import {
  ConfidentialClientApplication,
  AuthenticationResult,
  AuthorizationCodeRequest,
  AuthorizationUrlRequest,
} from "@azure/msal-node";
import { storage } from "../../storage";
import { getSession } from ".";
import { randomBytes } from "crypto";

interface MicrosoftProfile {
  sub: string;
  email?: string;
  preferred_username?: string;
  given_name?: string;
  family_name?: string;
  name?: string;
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

    app.get("/api/auth/microsoft/callback", (req, res) => {
      res.status(503).json({
        message: "Microsoft authentication is not configured.",
      });
    });

    app.post("/api/auth/microsoft/callback", (req, res) => {
      res.status(503).json({
        message: "Microsoft authentication is not configured.",
      });
    });

    return;
  }

  // Build redirect URL from request or use environment variable
  const getRedirectUrl = (req: any): string => {
    if (process.env.MICROSOFT_REDIRECT_URL) {
      return process.env.MICROSOFT_REDIRECT_URL;
    }
    const protocol = req.protocol || "http";
    const host = req.get("host") || "localhost:5000";
    return `${protocol}://${host}/api/auth/microsoft/callback`;
  };

  // Initialize MSAL ConfidentialClientApplication
  const msalConfig = {
    auth: {
      clientId: clientId!,
      authority: `https://login.microsoftonline.com/${tenantId}`,
      clientSecret: clientSecret!,
    },
  };

  const msalClient = new ConfidentialClientApplication(msalConfig);

  console.log("Microsoft Auth Configuration:");
  console.log("- Client ID:", clientId);
  console.log("- Tenant ID:", tenantId);

  // Microsoft login route - initiate OAuth flow
  app.get("/api/auth/microsoft", async (req, res) => {
    try {
      console.log("Microsoft login initiated");
      console.log("Request host:", req.get("host"));
      console.log("Request protocol:", req.protocol);

      const redirectUri = getRedirectUrl(req);
      console.log("- Redirect URL:", redirectUri);

      // Generate state for CSRF protection
      const state = randomBytes(32).toString("base64url");

      // Store state in session for validation
      (req.session as any).microsoftAuthState = state;

      const authCodeUrlParameters: AuthorizationUrlRequest = {
        scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
        redirectUri: redirectUri,
        state: state,
      };

      const authUrl = await msalClient.getAuthCodeUrl(authCodeUrlParameters);

      console.log("Redirecting to Microsoft login:", authUrl);
      res.redirect(authUrl);
    } catch (error) {
      console.error("Error during Microsoft authentication:", error);
      res.redirect("/auth?error=microsoft_auth_error");
    }
  });

  // Microsoft callback route - handle both GET and POST
  const handleCallback = async (req: any, res: any) => {
    try {
      console.log("Microsoft callback received");
      console.log("Callback method:", req.method);
      console.log("Callback query:", req.query);
      console.log("Callback body:", req.body);

      const code = req.query.code || req.body.code;
      const state = req.query.state || req.body.state;
      const error = req.query.error || req.body.error;
      const errorDescription =
        req.query.error_description || req.body.error_description;

      // Check for errors from Microsoft
      if (error) {
        console.error("Microsoft auth error:", error, errorDescription);
        return res.redirect(
          `/auth?error=microsoft_auth_failed&details=${encodeURIComponent(
            errorDescription || error
          )}`
        );
      }

      if (!code) {
        console.error("No authorization code received");
        return res.redirect("/auth?error=microsoft_no_code");
      }

      // Validate state
      const sessionState = (req.session as any)?.microsoftAuthState;
      if (!sessionState || sessionState !== state) {
        console.error("Invalid state parameter");
        return res.redirect("/auth?error=microsoft_invalid_state");
      }

      // Clear state from session
      delete (req.session as any).microsoftAuthState;

      const redirectUri = getRedirectUrl(req);

      // Exchange authorization code for tokens
      const tokenRequest: AuthorizationCodeRequest = {
        code: code,
        scopes: ["openid", "profile", "email", "offline_access", "User.Read"],
        redirectUri: redirectUri,
      };

      let tokenResponse: AuthenticationResult;
      try {
        tokenResponse = await msalClient.acquireTokenByCode(tokenRequest);
      } catch (tokenError: any) {
        console.error("Error acquiring token:", tokenError);
        return res.redirect("/auth?error=microsoft_token_error");
      }

      if (!tokenResponse || !tokenResponse.idToken) {
        console.error("No ID token in response");
        return res.redirect("/auth?error=microsoft_no_token");
      }

      // Decode ID token to get user profile
      // ID token is a JWT, we need to decode it
      const idTokenParts = tokenResponse.idToken.split(".");
      if (idTokenParts.length !== 3) {
        console.error("Invalid ID token format");
        return res.redirect("/auth?error=microsoft_invalid_token");
      }

      // Decode the payload (second part)
      const payload = JSON.parse(
        Buffer.from(idTokenParts[1], "base64").toString("utf-8")
      ) as MicrosoftProfile;

      const email = payload.email || payload.preferred_username;
      const firstName = payload.given_name || null;
      const lastName = payload.family_name || null;
      const sub = payload.sub;

      if (!email) {
        console.error("No email in ID token");
        return res.redirect("/auth?error=microsoft_no_email");
      }

      // Create or update user
      const userData = {
        id: `ms_${sub}`, // Prefix Microsoft users
        email: email,
        firstName: firstName || null,
        lastName: lastName || null,
        profileImageUrl: null,
      };

      const user = await storage.upsertUser(userData);

      // Create session user object compatible with Passport
      const sessionUser = {
        ...user,
        claims: {
          sub: userData.id,
          email: userData.email,
          first_name: userData.firstName,
          last_name: userData.lastName,
          profile_image_url: userData.profileImageUrl,
          exp: Math.floor(Date.now() / 1000) + 3600, // 1 hour
        },
        access_token: tokenResponse.accessToken,
        refresh_token: (tokenResponse as any).refreshToken || null,
        expires_at: tokenResponse.expiresOn
          ? Math.floor(tokenResponse.expiresOn.getTime() / 1000)
          : Math.floor(Date.now() / 1000) + 3600,
        authProvider: "microsoft",
      };

      // Log in user using Passport
      req.logIn(sessionUser, (loginErr: any) => {
        if (loginErr) {
          console.error("Login error:", loginErr);
          return res.redirect("/auth?error=login_failed");
        }
        // Successful authentication
        console.log("Microsoft authentication successful for:", email);
        res.redirect("/");
      });
    } catch (error) {
      console.error("Error in Microsoft callback:", error);
      res.redirect("/auth?error=microsoft_auth_error");
    }
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
