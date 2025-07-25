import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Badge } from "@/components/ui/badge";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Code } from "lucide-react";
export default function ApiDocs() {
  return (
    <div className="container mx-auto p-6 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold mb-2">API Documentation</h1>
          <p className="text-muted-foreground">
            Learn how to integrate with TicketFlow using our REST API
          </p>
        </div>

        <Alert className="mb-6">
          <Code className="h-4 w-4" />
          <AlertDescription>
            <strong>Base URL:</strong> {window.location.origin}/api
            <br />
            <strong>Authentication:</strong> Include your API key in the X-API-Key header
          </AlertDescription>
        </Alert>

        <Tabs defaultValue="authentication" className="space-y-4">
          <TabsList className="grid w-full grid-cols-4">
            <TabsTrigger value="authentication">Authentication</TabsTrigger>
            <TabsTrigger value="tasks">Tasks</TabsTrigger>
            <TabsTrigger value="teams">Teams</TabsTrigger>
            <TabsTrigger value="webhooks">Webhooks</TabsTrigger>
          </TabsList>

          <TabsContent value="authentication">
            <Card>
              <CardHeader>
                <CardTitle>Authentication</CardTitle>
                <CardDescription>
                  All API requests must include your API key in the request headers
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Request Headers</h3>
                  <pre className="bg-muted p-3 rounded-md overflow-x-auto">
{`X-API-Key: tfk_your_api_key_here
Content-Type: application/json`}
                  </pre>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Example Request</h3>
                  <pre className="bg-muted p-3 rounded-md overflow-x-auto text-sm">
{`curl -X GET \\
  ${window.location.origin}/api/tasks \\
  -H "X-API-Key: tfk_your_api_key_here" \\
  -H "Content-Type: application/json"`}
                  </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="tasks">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>List Tasks</CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="secondary">GET</Badge>
                    <code className="text-sm">/api/tasks</code>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-2">Query Parameters</h3>
                    <ul className="space-y-2 text-sm">
                      <li><code>status</code> - Filter by status (open, in_progress, resolved, closed)</li>
                      <li><code>priority</code> - Filter by priority (low, medium, high, urgent)</li>
                      <li><code>assigneeId</code> - Filter by assignee user ID</li>
                      <li><code>teamId</code> - Filter by team ID</li>
                    </ul>
                  </div>

                  <div>
                    <h3 className="text-sm font-medium mb-2">Response</h3>
                    <pre className="bg-muted p-3 rounded-md overflow-x-auto text-sm">
{`[
  {
    "id": 1,
    "ticketNumber": "TKT-2024-0001",
    "title": "Fix login issue",
    "description": "Users unable to login",
    "status": "open",
    "priority": "high",
    "severity": "major",
    "category": "bug",
    "tags": ["auth", "urgent"],
    "createdAt": "2024-01-15T10:00:00Z",
    "updatedAt": "2024-01-15T10:00:00Z"
  }
]`}
                    </pre>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Create Task</CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="secondary">POST</Badge>
                    <code className="text-sm">/api/tasks</code>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-2">Request Body</h3>
                    <pre className="bg-muted p-3 rounded-md overflow-x-auto text-sm">
{`{
  "title": "New bug report",
  "description": "Detailed description here",
  "status": "open",
  "priority": "medium",
  "severity": "normal",
  "category": "bug",
  "tags": ["frontend", "ui"],
  "assigneeId": "user123",
  "assigneeTeamId": 1,
  "dueDate": "2024-02-01T00:00:00Z"
}`}
                    </pre>
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>Update Task</CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="secondary">PATCH</Badge>
                    <code className="text-sm">/api/tasks/:id</code>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-2">Request Body</h3>
                    <pre className="bg-muted p-3 rounded-md overflow-x-auto text-sm">
{`{
  "status": "in_progress",
  "assigneeId": "user456"
}`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="teams">
            <div className="space-y-4">
              <Card>
                <CardHeader>
                  <CardTitle>List Teams</CardTitle>
                  <div className="flex gap-2">
                    <Badge variant="secondary">GET</Badge>
                    <code className="text-sm">/api/teams</code>
                  </div>
                </CardHeader>
                <CardContent className="space-y-4">
                  <div>
                    <h3 className="text-sm font-medium mb-2">Response</h3>
                    <pre className="bg-muted p-3 rounded-md overflow-x-auto text-sm">
{`[
  {
    "id": 1,
    "name": "Frontend Team",
    "description": "UI/UX development team",
    "createdBy": "user123",
    "createdAt": "2024-01-01T00:00:00Z"
  }
]`}
                    </pre>
                  </div>
                </CardContent>
              </Card>
            </div>
          </TabsContent>

          <TabsContent value="webhooks">
            <Card>
              <CardHeader>
                <CardTitle>Webhooks</CardTitle>
                <CardDescription>
                  Configure webhooks to receive real-time notifications about ticket events
                </CardDescription>
              </CardHeader>
              <CardContent className="space-y-4">
                <div>
                  <h3 className="text-sm font-medium mb-2">Available Events</h3>
                  <ul className="space-y-2 text-sm">
                    <li><code>task.created</code> - When a new task is created</li>
                    <li><code>task.updated</code> - When a task is updated</li>
                    <li><code>task.status_changed</code> - When task status changes</li>
                    <li><code>task.assigned</code> - When a task is assigned</li>
                    <li><code>comment.added</code> - When a comment is added</li>
                  </ul>
                </div>

                <div>
                  <h3 className="text-sm font-medium mb-2">Webhook Payload Example</h3>
                  <pre className="bg-muted p-3 rounded-md overflow-x-auto text-sm">
{`{
  "event": "task.created",
  "timestamp": "2024-01-15T10:00:00Z",
  "data": {
    "id": 1,
    "ticketNumber": "TKT-2024-0001",
    "title": "New task created",
    "createdBy": "user123"
  }
}`}
                    </pre>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
    </div>
  );
}