import { useState } from "react";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from "@/components/ui/card";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { CheckCircle, AlertCircle, Building2 } from "lucide-react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest, queryClient } from "@/lib/queryClient";
import { useLocation } from "wouter";
import { useToast } from "@/hooks/use-toast";

// Validation schemas
const loginSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(1, "Password is required"),
});

const registerSchema = z.object({
  email: z.string().email("Invalid email address"),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
  firstName: z.string().min(1, "First name is required"),
  lastName: z.string().min(1, "Last name is required"),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

const forgotPasswordSchema = z.object({
  email: z.string().email("Invalid email address"),
});

const resetPasswordSchema = z.object({
  token: z.string(),
  password: z.string().min(8, "Password must be at least 8 characters"),
  confirmPassword: z.string(),
}).refine((data) => data.password === data.confirmPassword, {
  message: "Passwords don't match",
  path: ["confirmPassword"],
});

type LoginForm = z.infer<typeof loginSchema>;
type RegisterForm = z.infer<typeof registerSchema>;
type ForgotPasswordForm = z.infer<typeof forgotPasswordSchema>;
type ResetPasswordForm = z.infer<typeof resetPasswordSchema>;

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const { toast } = useToast();
  
  // Check for URL params
  const urlParams = new URLSearchParams(window.location.search);
  const error = urlParams.get('error');
  const mode = urlParams.get('mode');
  const invitationEmail = urlParams.get('email');
  const invitationToken = urlParams.get('token');
  
  // Set initial tab based on mode parameter
  const [activeTab, setActiveTab] = useState<"signin" | "register" | "forgot">(
    mode === 'register' ? 'register' : 'signin'
  );
  
  // Show error message based on error type
  const getErrorMessage = (error: string | null) => {
    switch (error) {
      case 'microsoft_auth_failed':
        return 'Microsoft authentication failed. Please check your credentials and try again.';
      case 'microsoft_auth_error':
        return 'An error occurred during Microsoft authentication. Please try again.';
      case 'microsoft_no_user':
        return 'Unable to retrieve user information from Microsoft. Please try again.';
      case 'login_failed':
        return 'Login failed. Please try again.';
      default:
        return null;
    }
  };
  
  const errorMessage = getErrorMessage(error);
  const [resetToken, setResetToken] = useState<string>("");

  // Login form
  const loginForm = useForm<LoginForm>({
    resolver: zodResolver(loginSchema),
    defaultValues: {
      email: "",
      password: "",
    },
  });

  // Register form
  const registerForm = useForm<RegisterForm>({
    resolver: zodResolver(registerSchema),
    defaultValues: {
      email: invitationEmail || "",
      password: "",
      confirmPassword: "",
      firstName: "",
      lastName: "",
    },
  });

  // Forgot password form
  const forgotForm = useForm<ForgotPasswordForm>({
    resolver: zodResolver(forgotPasswordSchema),
    defaultValues: {
      email: "",
    },
  });

  // Reset password form
  const resetForm = useForm<ResetPasswordForm>({
    resolver: zodResolver(resetPasswordSchema),
    defaultValues: {
      token: resetToken,
      password: "",
      confirmPassword: "",
    },
  });

  // Login mutation
  const loginMutation = useMutation({
    mutationFn: async (data: LoginForm) => {
      const res = await apiRequest("POST", "/api/auth/login", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Login failed");
      }
      return res.json();
    },
    onSuccess: (user) => {
      queryClient.setQueryData(["/api/auth/user"], user);
      toast({
        title: "Welcome back!",
        description: "You have successfully logged in.",
      });
      setLocation("/");
    },
    onError: (error: Error) => {
      toast({
        title: "Login failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Register mutation
  const registerMutation = useMutation({
    mutationFn: async (data: Omit<RegisterForm, "confirmPassword">) => {
      const res = await apiRequest("POST", "/api/auth/register", {
        email: data.email,
        password: data.password,
        firstName: data.firstName,
        lastName: data.lastName,
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Registration failed");
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({
        title: "Account created!",
        description: data.message || "Your account is pending admin approval.",
      });
      setActiveTab("signin");
      registerForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Registration failed",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Forgot password mutation
  const forgotMutation = useMutation({
    mutationFn: async (data: ForgotPasswordForm) => {
      const res = await apiRequest("POST", "/api/auth/forgot-password", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to send reset email");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Reset email sent",
        description: "Check your email for password reset instructions.",
      });
      forgotForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to send reset email",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  // Reset password mutation
  const resetMutation = useMutation({
    mutationFn: async (data: Omit<ResetPasswordForm, "confirmPassword">) => {
      const res = await apiRequest("POST", "/api/auth/reset-password", data);
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || "Failed to reset password");
      }
      return res.json();
    },
    onSuccess: () => {
      toast({
        title: "Password reset successful",
        description: "You can now log in with your new password.",
      });
      setActiveTab("signin");
      setResetToken("");
      resetForm.reset();
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to reset password",
        description: error.message,
        variant: "destructive",
      });
    },
  });

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 to-slate-100 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl flex gap-8">
        {/* Auth Forms */}
        <div className="flex-1">
          <Card className="shadow-xl">
            <CardHeader className="space-y-1">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 bg-primary rounded-lg flex items-center justify-center">
                  <CheckCircle className="text-white w-6 h-6" />
                </div>
                <div>
                  <CardTitle className="text-2xl font-bold">TicketFlow</CardTitle>
                  <CardDescription>Professional Ticketing System</CardDescription>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {errorMessage && (
                <Alert variant="destructive" className="mb-4">
                  <AlertCircle className="h-4 w-4" />
                  <AlertDescription>{errorMessage}</AlertDescription>
                </Alert>
              )}
              
              {resetToken ? (
                // Reset Password Form
                <form onSubmit={resetForm.handleSubmit((data) => resetMutation.mutate(data))}>
                  <div className="space-y-4">
                    <div className="space-y-2">
                      <Label htmlFor="reset-password">New Password</Label>
                      <Input
                        id="reset-password"
                        type="password"
                        placeholder="Enter new password"
                        {...resetForm.register("password")}
                      />
                      {resetForm.formState.errors.password && (
                        <p className="text-sm text-destructive">{resetForm.formState.errors.password.message}</p>
                      )}
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor="reset-confirm-password">Confirm Password</Label>
                      <Input
                        id="reset-confirm-password"
                        type="password"
                        placeholder="Confirm new password"
                        {...resetForm.register("confirmPassword")}
                      />
                      {resetForm.formState.errors.confirmPassword && (
                        <p className="text-sm text-destructive">{resetForm.formState.errors.confirmPassword.message}</p>
                      )}
                    </div>
                    <Button
                      type="submit"
                      className="w-full"
                      disabled={resetMutation.isPending}
                    >
                      {resetMutation.isPending ? "Resetting..." : "Reset Password"}
                    </Button>
                    <Button
                      type="button"
                      variant="link"
                      className="w-full"
                      onClick={() => {
                        setResetToken("");
                        setActiveTab("signin");
                      }}
                    >
                      Back to Sign In
                    </Button>
                  </div>
                </form>
              ) : (
                <Tabs value={activeTab} onValueChange={(value) => setActiveTab(value as any)}>
                  <TabsList className="grid w-full grid-cols-3">
                    <TabsTrigger value="signin">Sign In</TabsTrigger>
                    <TabsTrigger value="register">Register</TabsTrigger>
                    <TabsTrigger value="forgot">Forgot Password</TabsTrigger>
                  </TabsList>

                  {/* Sign In Tab */}
                  <TabsContent value="signin">
                    <form onSubmit={loginForm.handleSubmit((data) => loginMutation.mutate(data))}>
                      <div className="space-y-4">
                        <div className="space-y-2">
                          <Label htmlFor="login-email">Email</Label>
                          <Input
                            id="login-email"
                            type="email"
                            placeholder="you@example.com"
                            {...loginForm.register("email")}
                          />
                          {loginForm.formState.errors.email && (
                            <p className="text-sm text-destructive">{loginForm.formState.errors.email.message}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="login-password">Password</Label>
                          <Input
                            id="login-password"
                            type="password"
                            placeholder="Enter your password"
                            {...loginForm.register("password")}
                          />
                          {loginForm.formState.errors.password && (
                            <p className="text-sm text-destructive">{loginForm.formState.errors.password.message}</p>
                          )}
                        </div>
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={loginMutation.isPending}
                        >
                          {loginMutation.isPending ? "Signing in..." : "Sign In"}
                        </Button>
                      </div>
                    </form>
                  </TabsContent>

                  {/* Register Tab */}
                  <TabsContent value="register">
                    <form onSubmit={registerForm.handleSubmit((data) => registerMutation.mutate(data))}>
                      <div className="space-y-4">
                        {invitationEmail && invitationToken && (
                          <Alert>
                            <CheckCircle className="h-4 w-4" />
                            <AlertDescription>
                              You've been invited to join TicketFlow! Complete the form below to create your account.
                            </AlertDescription>
                          </Alert>
                        )}
                        <div className="grid grid-cols-2 gap-4">
                          <div className="space-y-2">
                            <Label htmlFor="register-firstName">First Name</Label>
                            <Input
                              id="register-firstName"
                              placeholder="John"
                              {...registerForm.register("firstName")}
                            />
                            {registerForm.formState.errors.firstName && (
                              <p className="text-sm text-destructive">{registerForm.formState.errors.firstName.message}</p>
                            )}
                          </div>
                          <div className="space-y-2">
                            <Label htmlFor="register-lastName">Last Name</Label>
                            <Input
                              id="register-lastName"
                              placeholder="Doe"
                              {...registerForm.register("lastName")}
                            />
                            {registerForm.formState.errors.lastName && (
                              <p className="text-sm text-destructive">{registerForm.formState.errors.lastName.message}</p>
                            )}
                          </div>
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="register-email">Email</Label>
                          <Input
                            id="register-email"
                            type="email"
                            placeholder="you@example.com"
                            {...registerForm.register("email")}
                            disabled={!!invitationEmail}
                          />
                          {registerForm.formState.errors.email && (
                            <p className="text-sm text-destructive">{registerForm.formState.errors.email.message}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="register-password">Password</Label>
                          <Input
                            id="register-password"
                            type="password"
                            placeholder="Choose a strong password"
                            {...registerForm.register("password")}
                          />
                          {registerForm.formState.errors.password && (
                            <p className="text-sm text-destructive">{registerForm.formState.errors.password.message}</p>
                          )}
                        </div>
                        <div className="space-y-2">
                          <Label htmlFor="register-confirmPassword">Confirm Password</Label>
                          <Input
                            id="register-confirmPassword"
                            type="password"
                            placeholder="Confirm your password"
                            {...registerForm.register("confirmPassword")}
                          />
                          {registerForm.formState.errors.confirmPassword && (
                            <p className="text-sm text-destructive">{registerForm.formState.errors.confirmPassword.message}</p>
                          )}
                        </div>
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={registerMutation.isPending}
                        >
                          {registerMutation.isPending ? "Creating account..." : "Create Account"}
                        </Button>
                      </div>
                    </form>
                  </TabsContent>

                  {/* Forgot Password Tab */}
                  <TabsContent value="forgot">
                    <form onSubmit={forgotForm.handleSubmit((data) => forgotMutation.mutate(data))}>
                      <div className="space-y-4">
                        <Alert>
                          <AlertCircle className="h-4 w-4" />
                          <AlertDescription>
                            Enter your email address and we'll send you instructions to reset your password.
                          </AlertDescription>
                        </Alert>
                        <div className="space-y-2">
                          <Label htmlFor="forgot-email">Email</Label>
                          <Input
                            id="forgot-email"
                            type="email"
                            placeholder="you@example.com"
                            {...forgotForm.register("email")}
                          />
                          {forgotForm.formState.errors.email && (
                            <p className="text-sm text-destructive">{forgotForm.formState.errors.email.message}</p>
                          )}
                        </div>
                        <Button
                          type="submit"
                          className="w-full"
                          disabled={forgotMutation.isPending}
                        >
                          {forgotMutation.isPending ? "Sending..." : "Send Reset Instructions"}
                        </Button>
                      </div>
                    </form>
                  </TabsContent>
                </Tabs>
              )}
            </CardContent>
            <CardFooter className="flex flex-col space-y-4">
              <div className="relative w-full">
                <div className="absolute inset-0 flex items-center">
                  <span className="w-full border-t" />
                </div>
                <div className="relative flex justify-center text-xs uppercase">
                  <span className="bg-background px-2 text-muted-foreground">Or continue with</span>
                </div>
              </div>
              <Button
                variant="outline"
                className="w-full"
                onClick={() => {
                  // Directly redirect to Microsoft authentication
                  window.location.href = "/api/auth/microsoft";
                }}
              >
                <Building2 className="mr-2 h-4 w-4" />
                Microsoft 365
              </Button>
            </CardFooter>
          </Card>
        </div>

        {/* Hero Section */}
        <div className="flex-1 hidden lg:flex flex-col justify-center">
          <h1 className="text-4xl font-bold text-slate-900 mb-4">
            Welcome to TicketFlow
          </h1>
          <p className="text-lg text-slate-600 mb-8">
            The professional ticketing system designed for small businesses. 
            Streamline your support, track issues, and collaborate with your team.
          </p>
          <div className="space-y-4">
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-6 w-6 text-primary mt-0.5" />
              <div>
                <h3 className="font-semibold text-slate-900">Complete Ticket Management</h3>
                <p className="text-slate-600">Track issues from creation to resolution with full audit trails</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-6 w-6 text-primary mt-0.5" />
              <div>
                <h3 className="font-semibold text-slate-900">Team Collaboration</h3>
                <p className="text-slate-600">Assign tickets to teams, add comments, and track progress</p>
              </div>
            </div>
            <div className="flex items-start space-x-3">
              <CheckCircle className="h-6 w-6 text-primary mt-0.5" />
              <div>
                <h3 className="font-semibold text-slate-900">Enterprise Integration</h3>
                <p className="text-slate-600">Integrate with Microsoft 365 and Teams for seamless workflow</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}