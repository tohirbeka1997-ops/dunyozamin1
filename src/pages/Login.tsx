import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useToast } from '@/hooks/use-toast';
import { signIn, signUp } from '@/db/api';
import { Store } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [loading, setLoading] = useState(false);

  const [signInData, setSignInData] = useState({
    username: '',
    password: '',
  });

  const [signUpData, setSignUpData] = useState({
    username: '',
    password: '',
    confirmPassword: '',
    fullName: '',
  });

  const handleSignIn = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!signInData.username || !signInData.password) {
      toast({
        title: 'Error',
        description: 'Please fill in all fields',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await signIn(signInData.username, signInData.password);
      toast({
        title: 'Success',
        description: 'Signed in successfully',
      });
      navigate('/');
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to sign in',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSignUp = async (e: React.FormEvent) => {
    e.preventDefault();

    if (!signUpData.username || !signUpData.password || !signUpData.confirmPassword) {
      toast({
        title: 'Error',
        description: 'Please fill in all required fields',
        variant: 'destructive',
      });
      return;
    }

    if (!/^[a-zA-Z0-9_]+$/.test(signUpData.username)) {
      toast({
        title: 'Error',
        description: 'Username can only contain letters, numbers, and underscores',
        variant: 'destructive',
      });
      return;
    }

    if (signUpData.password !== signUpData.confirmPassword) {
      toast({
        title: 'Error',
        description: 'Passwords do not match',
        variant: 'destructive',
      });
      return;
    }

    if (signUpData.password.length < 6) {
      toast({
        title: 'Error',
        description: 'Password must be at least 6 characters',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      await signUp(signUpData.username, signUpData.password, signUpData.fullName);
      toast({
        title: 'Success',
        description: 'Account created successfully. You can now sign in.',
      });
      setSignInData({
        username: signUpData.username,
        password: signUpData.password,
      });
      setSignUpData({
        username: '',
        password: '',
        confirmPassword: '',
        fullName: '',
      });
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create account',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-primary flex items-center justify-center">
              <Store className="h-8 w-8 text-primary-foreground" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">POS System</CardTitle>
          <CardDescription>Point of Sale Management System</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="signin" className="w-full">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="signin">Sign In</TabsTrigger>
              <TabsTrigger value="signup">Sign Up</TabsTrigger>
            </TabsList>
            
            <TabsContent value="signin">
              <form onSubmit={handleSignIn} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signin-username">Username</Label>
                  <Input
                    id="signin-username"
                    type="text"
                    placeholder="Enter your username"
                    value={signInData.username}
                    onChange={(e) => setSignInData({ ...signInData, username: e.target.value })}
                    disabled={loading}
                    autoComplete="username"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signin-password">Password</Label>
                  <Input
                    id="signin-password"
                    type="password"
                    placeholder="Enter your password"
                    value={signInData.password}
                    onChange={(e) => setSignInData({ ...signInData, password: e.target.value })}
                    disabled={loading}
                    autoComplete="current-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Signing in...' : 'Sign In'}
                </Button>
              </form>
            </TabsContent>
            
            <TabsContent value="signup">
              <form onSubmit={handleSignUp} className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="signup-username">Username *</Label>
                  <Input
                    id="signup-username"
                    type="text"
                    placeholder="Choose a username"
                    value={signUpData.username}
                    onChange={(e) => setSignUpData({ ...signUpData, username: e.target.value })}
                    disabled={loading}
                    autoComplete="username"
                  />
                  <p className="text-xs text-muted-foreground">
                    Only letters, numbers, and underscores allowed
                  </p>
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-fullname">Full Name</Label>
                  <Input
                    id="signup-fullname"
                    type="text"
                    placeholder="Enter your full name (optional)"
                    value={signUpData.fullName}
                    onChange={(e) => setSignUpData({ ...signUpData, fullName: e.target.value })}
                    disabled={loading}
                    autoComplete="name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-password">Password *</Label>
                  <Input
                    id="signup-password"
                    type="password"
                    placeholder="Create a password"
                    value={signUpData.password}
                    onChange={(e) => setSignUpData({ ...signUpData, password: e.target.value })}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="signup-confirm">Confirm Password *</Label>
                  <Input
                    id="signup-confirm"
                    type="password"
                    placeholder="Confirm your password"
                    value={signUpData.confirmPassword}
                    onChange={(e) => setSignUpData({ ...signUpData, confirmPassword: e.target.value })}
                    disabled={loading}
                    autoComplete="new-password"
                  />
                </div>
                <Button type="submit" className="w-full" disabled={loading}>
                  {loading ? 'Creating account...' : 'Sign Up'}
                </Button>
              </form>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}
