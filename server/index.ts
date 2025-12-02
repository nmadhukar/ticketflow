import "dotenv/config";
import express, { type Request, Response, NextFunction } from "express";
import { registerRoutes } from "./routes/index";
import { setupVite, serveStatic, log } from "./vite";
import {
  applySecurity,
  applyRouteSpecificSecurity,
  securityHealthCheck,
} from "./security";

const app = express();

// Trust Nginx/reverse proxy so req.ip uses the real client IP via X-Forwarded-For
app.set("trust proxy", 1);

// Apply security middleware first
applySecurity(app);

// Increase JSON body parser limit to handle base64 file uploads (logo, etc.)
// Increased to support file uploads with task creation
// Uses MAX_REQUEST_SIZE_MB env variable, defaults to 50MB
const maxRequestSizeMB = parseInt(process.env.MAX_REQUEST_SIZE_MB || "50", 10);
app.use(express.json({ limit: `${maxRequestSizeMB}mb` }));
app.use(express.urlencoded({ extended: true, limit: `${maxRequestSizeMB}mb` }));

app.use((req, res, next) => {
  const start = Date.now();
  const path = req.path;
  let capturedJsonResponse: Record<string, any> | undefined = undefined;

  const originalResJson = res.json;
  res.json = function (bodyJson, ...args) {
    capturedJsonResponse = bodyJson;
    return originalResJson.apply(res, [bodyJson, ...args]);
  };

  res.on("finish", () => {
    const duration = Date.now() - start;
    if (path.startsWith("/api")) {
      let logLine = `${req.method} ${path} ${res.statusCode} in ${duration}ms`;
      if (capturedJsonResponse) {
        logLine += ` :: ${JSON.stringify(capturedJsonResponse)}`;
      }

      if (logLine.length > 80) {
        logLine = logLine.slice(0, 79) + "…";
      }

      log(logLine);
    }
  });

  next();
});

(async () => {
  try {
    // Log environment info for debugging
    console.log("Starting TicketFlow application...");
    console.log("NODE_ENV:", process.env.NODE_ENV);
    console.log("PORT:", process.env.PORT);
    console.log("DATABASE_URL exists:", !!process.env.DATABASE_URL);

    // Seed default users, departments, teams, tickets, knowledge articles, and help/docs on startup
    try {
      const {
        seedUsers,
        seedDepartments,
        seedTeams,
        seedTickets,
        seedKnowledgeArticles,
        seedHelpAndDocs,
        seedEmailTemplates,
        seedKnowledgeLearning,
      } = await import("./seed");
      await seedUsers();
      await seedDepartments();
      await seedTeams();
      await seedTickets();
      await seedKnowledgeArticles();
      await seedHelpAndDocs();
      await seedEmailTemplates();
      await seedKnowledgeLearning();
    } catch (error) {
      console.error("Failed to run seeders:", error);
    }
  } catch (error) {
    console.error("Startup error:", error);
    process.exit(1);
  }

  // Apply route-specific security
  applyRouteSpecificSecurity(app);

  const server = await registerRoutes(app);

  // Simple health check endpoint (no database required)
  app.get("/health", (req, res) => {
    res.json({
      status: "ok",
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV,
      port: process.env.PORT,
    });
  });

  // Security health check endpoint
  app.get("/api/security/health", (req, res) => {
    res.json(securityHealthCheck());
  });

  app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
    const status = err.status || err.statusCode || 500;
    const message = err.message || "Internal Server Error";

    res.status(status).json({ message });
    throw err;
  });

  // importantly only setup vite in development and after
  // setting up all the other routes so the catch-all route
  // doesn't interfere with the other routes
  if (app.get("env") === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }

  // ALWAYS serve the app on the port specified in the environment variable PORT
  // Other ports are firewalled. Default to 5000 if not specified.
  // this serves both the API and the client.
  // It is the only port that is not firewalled.
  const port = parseInt(process.env.PORT || "5000", 10);
  const isWindows = process.platform === "win32";
  const listenOptions: any = { port, host: "0.0.0.0" };
  if (!isWindows) listenOptions.reusePort = true;

  server
    .listen(listenOptions, () => {
      log(`serving on port ${port}`);
    })
    .on("error", (error) => {
      console.error("Server startup error:", error);
      process.exit(1);
    });
})();
