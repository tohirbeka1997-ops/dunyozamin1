import { useState } from 'react';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Plus, Sparkles } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { createCustomer } from '@/db/api';
import type { Customer } from '@/types/database';

interface QuickCustomerCreateProps {
  onCustomerCreated: (customer: Customer) => void;
}

export default function QuickCustomerCreate({ onCustomerCreated }: QuickCustomerCreateProps) {
  const { toast } = useToast();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [formData, setFormData] = useState({
    name: '',
    customerCode: '',
    phone: '',
    creditLimit: '0',
    notes: '',
  });

  // Generate random 6-digit customer code
  const generateCustomerCode = () => {
    const randomNum = Math.floor(100000 + Math.random() * 900000);
    return `C-${randomNum}`;
  };

  // Phone mask formatting: +998 (XX) XXX-XX-XX
  const formatPhone = (value: string) => {
    // Remove all non-digits
    const digits = value.replace(/\D/g, '');
    
    // If starts with 998, keep it, otherwise add +998
    let formatted = digits;
    if (digits.startsWith('998')) {
      formatted = digits;
    } else if (digits.startsWith('9')) {
      formatted = '998' + digits.substring(1);
    } else if (digits.length > 0) {
      formatted = '998' + digits;
    }
    
    // Limit to 12 digits (998 + 9 digits)
    formatted = formatted.substring(0, 12);
    
    // Format: +998 (XX) XXX-XX-XX
    if (formatted.length === 0) return '';
    if (formatted.length <= 3) return `+${formatted}`;
    if (formatted.length <= 5) return `+${formatted.substring(0, 3)} (${formatted.substring(3)}`;
    if (formatted.length <= 8) return `+${formatted.substring(0, 3)} (${formatted.substring(3, 5)}) ${formatted.substring(5)}`;
    if (formatted.length <= 10) return `+${formatted.substring(0, 3)} (${formatted.substring(3, 5)}) ${formatted.substring(5, 8)}-${formatted.substring(8)}`;
    return `+${formatted.substring(0, 3)} (${formatted.substring(3, 5)}) ${formatted.substring(5, 8)}-${formatted.substring(8, 10)}-${formatted.substring(10)}`;
  };

  const handlePhoneChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const formatted = formatPhone(e.target.value);
    setFormData({ ...formData, phone: formatted });
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    
    if (!formData.name.trim()) {
      toast({
        title: 'Validation Error',
        description: 'Customer name is required',
        variant: 'destructive',
      });
      return;
    }

    setLoading(true);
    try {
      // Extract phone digits for storage (remove formatting)
      const phoneDigits = formData.phone.replace(/\D/g, '');
      const phoneValue = phoneDigits ? (phoneDigits.startsWith('998') ? `+${phoneDigits}` : `+998${phoneDigits}`) : null;
      
      // Parse credit limit
      const creditLimit = parseFloat(formData.creditLimit) || 0;
      
      // Combine notes with customer code if provided
      let notes = formData.notes.trim();
      if (formData.customerCode.trim()) {
        notes = notes 
          ? `Code: ${formData.customerCode.trim()}\n${notes}`
          : `Code: ${formData.customerCode.trim()}`;
      }
      
      const newCustomer = await createCustomer({
        name: formData.name.trim(),
        phone: phoneValue,
        email: null,
        address: null,
        type: 'individual',
        company_name: null,
        tax_number: null,
        credit_limit: creditLimit,
        allow_debt: creditLimit > 0,
        status: 'active',
        notes: notes || null,
      });

      toast({
        title: 'Success',
        description: `Customer "${newCustomer.name}" created successfully`,
      });

      onCustomerCreated(newCustomer);
      setOpen(false);
      setFormData({ name: '', customerCode: '', phone: '', creditLimit: '0', notes: '' });
    } catch (error) {
      console.error('Error creating customer:', error);
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to create customer',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="outline" size="icon" className="shrink-0">
          <Plus className="h-4 w-4" />
        </Button>
      </DialogTrigger>
      <DialogContent className="max-w-md">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>Quick Customer Create</DialogTitle>
            <DialogDescription>
              Add a new customer quickly during checkout
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            {/* Row 1: Name (60%) | Customer Code (40%) */}
            <div className="grid grid-cols-5 gap-4">
              <div className="col-span-3 space-y-2">
                <Label htmlFor="name">
                  Name <span className="text-destructive">*</span>
                </Label>
                <Input
                  id="name"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  placeholder="Customer name"
                  required
                  autoFocus
                />
              </div>
              <div className="col-span-2 space-y-2">
                <Label htmlFor="customerCode">
                  Customer Code <span className="text-xs text-muted-foreground">(Maxsus kod)</span>
                </Label>
                <div className="flex gap-1">
                  <Input
                    id="customerCode"
                    value={formData.customerCode}
                    onChange={(e) => setFormData({ ...formData, customerCode: e.target.value })}
                    placeholder="C-123456"
                    className="flex-1"
                  />
                  <Button
                    type="button"
                    variant="outline"
                    size="icon"
                    onClick={() => setFormData({ ...formData, customerCode: generateCustomerCode() })}
                    title="Generate random code"
                  >
                    <Sparkles className="h-4 w-4" />
                  </Button>
                </div>
              </div>
            </div>

            {/* Row 2: Phone (50%) | Credit Limit (50%) */}
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="phone">Phone</Label>
                <Input
                  id="phone"
                  type="tel"
                  value={formData.phone}
                  onChange={handlePhoneChange}
                  placeholder="+998 (XX) XXX-XX-XX"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="creditLimit">
                  Credit Limit <span className="text-xs text-muted-foreground">(Nasiya limiti)</span>
                </Label>
                <Input
                  id="creditLimit"
                  type="number"
                  step="0.01"
                  min="0"
                  value={formData.creditLimit}
                  onChange={(e) => setFormData({ ...formData, creditLimit: e.target.value })}
                  placeholder="0"
                />
              </div>
            </div>

            {/* Row 3: Notes (Full width) */}
            <div className="space-y-2">
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                value={formData.notes}
                onChange={(e) => setFormData({ ...formData, notes: e.target.value })}
                placeholder="Optional notes"
                rows={2}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={loading}>
              {loading ? 'Creating...' : 'Create Customer'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  );
}
