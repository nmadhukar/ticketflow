import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle, CardFooter } from "@/components/ui/card";
import { Building2 } from "lucide-react";
import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

export default function LoginPage() {
  const [showForgotDialog, setShowForgotDialog] = useState(false);
  const [forgotType, setForgotType] = useState<"username" | "password" | null>(null);

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="flex justify-center mb-8">
          <div className="flex items-center gap-2">
            <Building2 className="h-10 w-10 text-slate-700" />
            <h1 className="text-3xl font-bold text-slate-800">TicketFlow</h1>
          </div>
        </div>

        <Card className="shadow-xl">
          <CardHeader className="space-y-1">
            <CardTitle className="text-2xl font-bold text-center">Welcome back</CardTitle>
            <CardDescription className="text-center">
              Sign in to your account to continue
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Button 
              className="w-full h-12 text-base font-medium"
              onClick={() => window.location.href = "/api/login"}
            >
              Sign in with Replit
            </Button>
            
            <div className="relative">
              <div className="absolute inset-0 flex items-center">
                <span className="w-full border-t" />
              </div>
              <div className="relative flex justify-center text-xs uppercase">
                <span className="bg-white px-2 text-muted-foreground">Need help?</span>
              </div>
            </div>

            <div className="flex justify-between text-sm">
              <button
                className="text-blue-600 hover:text-blue-800 hover:underline"
                onClick={() => {
                  setForgotType("username");
                  setShowForgotDialog(true);
                }}
              >
                Forgot username?
              </button>
              <button
                className="text-blue-600 hover:text-blue-800 hover:underline"
                onClick={() => {
                  setForgotType("password");
                  setShowForgotDialog(true);
                }}
              >
                Forgot password?
              </button>
            </div>
          </CardContent>
          <CardFooter>
            <p className="text-center text-sm text-muted-foreground w-full">
              Don't have an account?{" "}
              <a href="/api/login" className="text-blue-600 hover:text-blue-800 hover:underline">
                Sign up
              </a>
            </p>
          </CardFooter>
        </Card>

        <Dialog open={showForgotDialog} onOpenChange={setShowForgotDialog}>
          <DialogContent>
            <DialogHeader>
              <DialogTitle>
                {forgotType === "username" ? "Forgot Username" : "Forgot Password"}
              </DialogTitle>
              <DialogDescription>
                {forgotType === "username" 
                  ? "Your username is the email address associated with your Replit account. If you can't remember which email you used, please check your email accounts for messages from Replit."
                  : "To reset your password, please visit your Replit account settings. TicketFlow uses Replit's secure authentication system, so password resets must be done through Replit."}
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4">
              {forgotType === "password" && (
                <Button 
                  className="w-full"
                  onClick={() => window.open("https://replit.com/account", "_blank")}
                >
                  Go to Replit Account Settings
                </Button>
              )}
              <Button 
                variant="outline" 
                className="w-full"
                onClick={() => setShowForgotDialog(false)}
              >
                Close
              </Button>
            </div>
          </DialogContent>
        </Dialog>
      </div>
    </div>
  );
}