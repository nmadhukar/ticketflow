import { Client } from "@microsoft/microsoft-graph-client";
import { ConfidentialClientApplication } from "@azure/msal-node";
import { Task } from "@shared/schema";

interface TeamsNotificationSettings {
  enabled: boolean;
  channelId?: string;
  teamId?: string;
  webhookUrl?: string;
}

export class MicrosoftTeamsIntegration {
  private msalClient: ConfidentialClientApplication | null = null;
  private graphClient: Client | null = null;

  constructor() {
    if (process.env.MICROSOFT_CLIENT_ID && process.env.MICROSOFT_CLIENT_SECRET && process.env.MICROSOFT_TENANT_ID) {
      this.msalClient = new ConfidentialClientApplication({
        auth: {
          clientId: process.env.MICROSOFT_CLIENT_ID,
          authority: `https://login.microsoftonline.com/${process.env.MICROSOFT_TENANT_ID}`,
          clientSecret: process.env.MICROSOFT_CLIENT_SECRET,
        },
      });
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.msalClient) {
      console.error("Microsoft Teams integration not configured");
      return null;
    }

    try {
      const result = await this.msalClient.acquireTokenByClientCredential({
        scopes: ["https://graph.microsoft.com/.default"],
      });

      return result?.accessToken || null;
    } catch (error) {
      console.error("Error acquiring access token:", error);
      return null;
    }
  }

  private async getGraphClient(): Promise<Client | null> {
    const accessToken = await this.getAccessToken();
    if (!accessToken) return null;

    if (!this.graphClient) {
      this.graphClient = Client.init({
        authProvider: (done) => {
          done(null, accessToken);
        },
      });
    }

    return this.graphClient;
  }

  async sendChannelNotification(
    teamId: string,
    channelId: string,
    task: Task,
    message: string,
    actionUrl: string
  ): Promise<boolean> {
    const client = await this.getGraphClient();
    if (!client) return false;

    try {
      const adaptiveCard = {
        contentType: "html",
        content: `
          <div style="border-left: 4px solid #0078d4; padding-left: 10px;">
            <h3>🎫 Ticket ${task.ticketNumber}: ${task.title}</h3>
            <p>${message}</p>
            <p><strong>Status:</strong> ${task.status.replace('_', ' ').toUpperCase()}</p>
            <p><strong>Priority:</strong> ${task.priority.toUpperCase()}</p>
            ${task.assigneeId ? `<p><strong>Assigned to:</strong> ${task.assigneeId}</p>` : ''}
            <p><a href="${actionUrl}" style="color: #0078d4;">View Ticket</a></p>
          </div>
        `,
      };

      await client
        .api(`/teams/${teamId}/channels/${channelId}/messages`)
        .post({
          body: adaptiveCard,
        });

      return true;
    } catch (error) {
      console.error("Error sending Teams notification:", error);
      return false;
    }
  }

  async sendWebhookNotification(
    webhookUrl: string,
    task: Task,
    message: string,
    actionUrl: string
  ): Promise<boolean> {
    try {
      const card = {
        "@type": "MessageCard",
        "@context": "https://schema.org/extensions",
        "themeColor": task.priority === "urgent" ? "FF0000" : "0078D4",
        "summary": `Ticket ${task.ticketNumber}: ${task.title}`,
        "sections": [
          {
            "activityTitle": `🎫 Ticket ${task.ticketNumber}`,
            "activitySubtitle": task.title,
            "facts": [
              {
                "name": "Status",
                "value": task.status.replace('_', ' ').toUpperCase(),
              },
              {
                "name": "Priority",
                "value": task.priority.toUpperCase(),
              },
              {
                "name": "Category",
                "value": task.category.charAt(0).toUpperCase() + task.category.slice(1),
              },
            ],
            "text": message,
            "markdown": true,
          },
        ],
        "potentialAction": [
          {
            "@type": "OpenUri",
            "name": "View Ticket",
            "targets": [
              {
                "os": "default",
                "uri": actionUrl,
              },
            ],
          },
        ],
      };

      const response = await fetch(webhookUrl, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
        },
        body: JSON.stringify(card),
      });

      return response.ok;
    } catch (error) {
      console.error("Error sending webhook notification:", error);
      return false;
    }
  }

  async listTeamsAndChannels(userAccessToken: string): Promise<any[]> {
    try {
      const client = Client.init({
        authProvider: (done) => {
          done(null, userAccessToken);
        },
      });

      // Get user's teams
      const teams = await client.api("/me/joinedTeams").get();
      
      // Get channels for each team
      const teamsWithChannels = await Promise.all(
        teams.value.map(async (team: any) => {
          try {
            const channels = await client.api(`/teams/${team.id}/channels`).get();
            return {
              id: team.id,
              displayName: team.displayName,
              description: team.description,
              channels: channels.value.map((channel: any) => ({
                id: channel.id,
                displayName: channel.displayName,
                description: channel.description,
              })),
            };
          } catch (error) {
            console.error(`Error fetching channels for team ${team.id}:`, error);
            return {
              id: team.id,
              displayName: team.displayName,
              description: team.description,
              channels: [],
            };
          }
        })
      );

      return teamsWithChannels;
    } catch (error) {
      console.error("Error listing teams and channels:", error);
      return [];
    }
  }

  async createTeamsWebhook(
    teamId: string,
    channelId: string,
    webhookName: string,
    userAccessToken: string
  ): Promise<string | null> {
    try {
      const client = Client.init({
        authProvider: (done) => {
          done(null, userAccessToken);
        },
      });

      // Note: Creating webhooks programmatically requires additional permissions
      // Users typically need to create webhooks manually in Teams
      console.log("Webhook creation info:", { teamId, channelId, webhookName });
      
      // Return instructions for manual webhook creation
      return null;
    } catch (error) {
      console.error("Error creating webhook:", error);
      return null;
    }
  }
}

export const teamsIntegration = new MicrosoftTeamsIntegration();