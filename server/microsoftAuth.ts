import { Express } from "express";
import passport from "passport";
import { OIDCStrategy, IProfile, VerifyCallback } from "passport-azure-ad";
import { storage } from "./storage";
import { getSession } from "./replitAuth";

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
  const clientSecret = ssoConfig?.clientSecret || process.env.MICROSOFT_CLIENT_SECRET;
  const tenantId = ssoConfig?.tenantId || process.env.MICROSOFT_TENANT_ID;
  
  const isMicrosoftConfigured = clientId && clientSecret && tenantId;
  
  if (!isMicrosoftConfigured) {
    if (!ssoConfig) {
      console.log("Microsoft authentication not configured. Configure in Admin Panel or set environment variables.");
    }
    
    // Register routes that return configuration error
    app.get("/api/auth/microsoft", async (req, res) => {
      // Re-check database in case config was added after server start
      const latestConfig = await storage.getSsoConfiguration();
      if (latestConfig?.clientId && latestConfig?.clientSecret && latestConfig?.tenantId) {
        // Config now exists, restart server would be needed
        res.status(503).json({ 
          message: "Microsoft authentication configuration has been updated. Please restart the server to apply changes." 
        });
      } else {
        res.status(503).json({ 
          message: "Microsoft authentication is not configured. Please contact your administrator to set up Microsoft 365 SSO." 
        });
      }
    });
    
    app.post("/api/auth/microsoft/callback", (req, res) => {
      res.status(503).json({ 
        message: "Microsoft authentication is not configured." 
      });
    });
    
    return;
  }

  const config = {
    identityMetadata: `https://login.microsoftonline.com/${tenantId}/v2.0/.well-known/openid-configuration`,
    clientID: clientId,
    responseType: "code",
    responseMode: "form_post",
    redirectUrl: `${process.env.REPLIT_DOMAINS?.split(',')[0] ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 'http://localhost:5000'}/api/auth/microsoft/callback`,
    allowHttpForRedirectUrl: process.env.NODE_ENV === "development",
    clientSecret: clientSecret,
    validateIssuer: true,
    passReqToCallback: false,
    scope: ["profile", "email", "offline_access", "User.Read"],
    loggingLevel: "error",
    nonceLifetime: 240,
    nonceMaxAmount: 5,
    useCookieInsteadOfSession: false,
    cookieSameSite: true,
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
        email: email || '',
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
        authProvider: 'microsoft',
      };

      return done(null, user);
    } catch (error) {
      return done(error as Error);
    }
  };

  passport.use("azuread-openidconnect", new OIDCStrategy(config as any, verify));

  // Serialize/deserialize user (shared with Replit auth)
  if (!passport.serializeUser.length) {
    passport.serializeUser((user: Express.User, cb) => cb(null, user));
    passport.deserializeUser((user: Express.User, cb) => cb(null, user));
  }

  // Microsoft login route
  app.get("/api/auth/microsoft",
    passport.authenticate("azuread-openidconnect", {
      failureRedirect: "/",
    })
  );

  // Microsoft callback route
  app.post("/api/auth/microsoft/callback",
    passport.authenticate("azuread-openidconnect", {
      failureRedirect: "/",
    }),
    (req, res) => {
      // Successful authentication
      res.redirect("/");
    }
  );

  console.log("Microsoft authentication configured successfully");
}

// Helper function to check if user is authenticated via Microsoft
export function isMicrosoftUser(user: any): boolean {
  return user?.authProvider === 'microsoft' || user?.claims?.sub?.startsWith('ms_');
}