import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

/**
 * Shown instead of the app while /api/auth/user reports mustChangePassword
 * (an admin reset the password). The server refuses every other request until
 * this succeeds; afterwards the user query is refreshed and the app returns.
 */
export function ForcedPasswordChange() {
  const queryClient = useQueryClient();
  const [currentPassword, setCurrentPassword] = useState("");
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function signOut() {
    setError(null);
    try {
      await apiRequest("POST", "/api/auth/logout");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not sign out.");
      return;
    }
    // A refetch would 401 yet keep the previous (flagged) user in the cache, so
    // mark the user signed out directly and drop everything else cached.
    queryClient.setQueryData(["/api/auth/user"], null);
    queryClient.removeQueries({ predicate: (q) => q.queryKey[0] !== "/api/auth/user" });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    if (password.length < 8) return setError("The new password must be at least 8 characters.");
    if (password !== confirm) return setError("The new password and its confirmation do not match.");
    setBusy(true);
    try {
      await apiRequest("POST", "/api/auth/change-password", { currentPassword, password });
      await queryClient.invalidateQueries({ queryKey: ["/api/auth/user"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not change the password.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>Choose a new password</CardTitle>
          <p className="text-sm text-muted-foreground">
            An administrator reset your password. Enter the temporary password you were given, then choose your own.
          </p>
        </CardHeader>
        <CardContent>
          <form onSubmit={submit} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="current-password">Temporary password</Label>
              <Input id="current-password" type="password" autoComplete="current-password" value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="new-password">New password</Label>
              <Input id="new-password" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
            <div className="space-y-2">
              <Label htmlFor="confirm-password">Confirm new password</Label>
              <Input id="confirm-password" type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />
            </div>
            {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
            <Button type="submit" className="w-full" disabled={busy}>
              {busy ? "Saving..." : "Change password"}
            </Button>
            <Button type="button" variant="ghost" className="w-full" onClick={signOut}>
              Sign out
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
