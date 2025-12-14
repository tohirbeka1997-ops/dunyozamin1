/**
 * Forbidden Page
 * Shown when user doesn't have required role
 */

import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { AlertCircle } from 'lucide-react';

export default function ForbiddenPage() {
  const navigate = useNavigate();

  return (
    <div className="min-h-screen flex items-center justify-center bg-muted/30 p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="space-y-1 text-center">
          <div className="flex justify-center mb-4">
            <div className="h-16 w-16 rounded-full bg-destructive/10 flex items-center justify-center">
              <AlertCircle className="h-8 w-8 text-destructive" />
            </div>
          </div>
          <CardTitle className="text-2xl font-bold">Kirish taqiqlangan</CardTitle>
          <CardDescription>
            Sizda bu sahifaga kirish uchun yetarli huquq yo'q
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-center text-muted-foreground">
            Bu sahifaga kirish uchun admin yoki manager huquqi kerak.
            Agar sizda bu huquq bo'lishi kerak bo'lsa, administrator bilan bog'laning.
          </p>
          <Button onClick={() => navigate('/')} className="w-full">
            Bosh sahifaga qaytish
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}


