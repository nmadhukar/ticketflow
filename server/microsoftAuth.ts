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

  // Check if Microsoft auth is configured
  if (!process.env.MICROSOFT_CLIENT_ID || !process.env.MICROSOFT_CLIENT_SECRET || !process.env.MICROSOFT_TENANT_ID) {
    console.log("Microsoft authentication not configured. Set MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET, and MICROSOFT_TENANT_ID to enable.");
    return;
  }

  const config = {
    identityMetadata: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}/v2.0/.well-known/openid-configuration`,
    clientID: process.env.MICROSOFT_CLIENT_ID,
    responseType: "code",
    responseMode: "form_post",
    redirectUrl: `${process.env.REPLIT_DOMAINS?.split(',')[0] ? `https://${process.env.REPLIT_DOMAINS.split(',')[0]}` : 'http://localhost:5000'}/api/auth/microsoft/callback`,
    allowHttpForRedirectUrl: process.env.NODE_ENV === "development",
    clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
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