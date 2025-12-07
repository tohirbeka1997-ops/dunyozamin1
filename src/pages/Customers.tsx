import { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table';
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from '@/components/ui/alert-dialog';
import { getCustomers, deleteCustomer } from '@/db/api';
import type { Customer } from '@/types/database';
import { Search, Plus, Eye, Edit, Trash2, Download, ArrowUpDown, DollarSign } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import ReceivePaymentDialog from '@/components/customers/ReceivePaymentDialog';

export default function Customers() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [typeFilter, setTypeFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [debtFilter, setDebtFilter] = useState('all');
  const [sortBy, setSortBy] = useState('created_at');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('desc');
  const [paymentDialogOpen, setPaymentDialogOpen] = useState(false);
  const [selectedCustomerForPayment, setSelectedCustomerForPayment] = useState<Customer | null>(null);

  useEffect(() => {
    loadCustomers();
  }, [searchTerm, typeFilter, statusFilter, debtFilter, sortBy, sortOrder]);

  const loadCustomers = async () => {
    try {
      setLoading(true);
      const hasDebt = debtFilter === 'with_debt' ? true : debtFilter === 'no_debt' ? false : undefined;
      const data = await getCustomers({
        searchTerm: searchTerm || undefined,
        type: typeFilter,
        status: statusFilter,
        hasDebt,
        sortBy,
        sortOrder,
      });
      setCustomers(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load customers',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleDelete = async (id: string, name: string) => {
    try {
      await deleteCustomer(id);
      toast({
        title: 'Success',
        description: `Customer "${name}" deleted successfully`,
      });
      loadCustomers();
    } catch (error) {
      toast({
        title: 'Error',
        description: error instanceof Error ? error.message : 'Failed to delete customer',
        variant: 'destructive',
      });
    }
  };

  const handleReceivePayment = (customer: Customer) => {
    setSelectedCustomerForPayment(customer);
    setPaymentDialogOpen(true);
  };

  const handlePaymentSuccess = () => {
    loadCustomers(); // Refresh customer list to show updated balance
  };

  const handleSort = (field: string) => {
    if (sortBy === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortBy(field);
      setSortOrder('asc');
    }
  };

  const getBalanceBadge = (balance: number) => {
    if (balance > 0) {
      return <Badge variant="destructive">${balance.toFixed(2)} Debt</Badge>;
    } else if (balance < 0) {
      return <Badge className="bg-success text-success-foreground">${Math.abs(balance).toFixed(2)} Credit</Badge>;
    } else {
      return <Badge variant="outline">$0.00</Badge>;
    }
  };

  const getStatusBadge = (status: string) => {
    return status === 'active' ? (
      <Badge className="bg-success text-success-foreground">Active</Badge>
    ) : (
      <Badge variant="outline">Inactive</Badge>
    );
  };

  const getTypeBadge = (type: string) => {
    return type === 'company' ? (
      <Badge variant="secondary">Company</Badge>
    ) : (
      <Badge variant="outline">Individual</Badge>
    );
  };

  const handleExport = () => {
    toast({
      title: 'Export',
      description: 'Export functionality coming soon',
    });
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Customers</h1>
          <p className="text-muted-foreground">Manage your customer database</p>
        </div>
        <div className="flex items-center gap-2">
          <Button variant="outline" onClick={handleExport}>
            <Download className="h-4 w-4 mr-2" />
            Export
          </Button>
          <Button onClick={() => navigate('/customers/new')}>
            <Plus className="h-4 w-4 mr-2" />
            Add Customer
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-5 gap-4">
              <div className="relative md:col-span-2">
                <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
                <Input
                  placeholder="Search by name, phone, or email..."
                  value={searchTerm}
                  onChange={(e) => setSearchTerm(e.target.value)}
                  className="pl-9"
                />
              </div>

              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Type" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="individual">Individual</SelectItem>
                  <SelectItem value="company">Company</SelectItem>
                </SelectContent>
              </Select>

              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Status</SelectItem>
                  <SelectItem value="active">Active</SelectItem>
                  <SelectItem value="inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>

              <Select value={debtFilter} onValueChange={setDebtFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="Balance" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Balances</SelectItem>
                  <SelectItem value="with_debt">With Debt</SelectItem>
                  <SelectItem value="no_debt">No Debt</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {loading ? (
              <div className="flex justify-center py-12">
                <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
              </div>
            ) : customers.length === 0 ? (
              <div className="text-center py-12">
                <p className="text-muted-foreground">No customers found</p>
                <Button className="mt-4" onClick={() => navigate('/customers/new')}>
                  <Plus className="h-4 w-4 mr-2" />
                  Add First Customer
                </Button>
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      <Button variant="ghost" size="sm" onClick={() => handleSort('name')}>
                        Name
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>Phone</TableHead>
                    <TableHead>Type</TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleSort('total_sales')}>
                        Total Sales
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead className="text-right">
                      <Button variant="ghost" size="sm" onClick={() => handleSort('balance')}>
                        Balance
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>
                      <Button variant="ghost" size="sm" onClick={() => handleSort('last_order_date')}>
                        Last Order
                        <ArrowUpDown className="ml-2 h-4 w-4" />
                      </Button>
                    </TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {customers.map((customer) => (
                    <TableRow key={customer.id}>
                      <TableCell>
                        <div>
                          <p className="font-medium">{customer.name}</p>
                          {customer.company_name && (
                            <p className="text-sm text-muted-foreground">{customer.company_name}</p>
                          )}
                        </div>
                      </TableCell>
                      <TableCell>{customer.phone || '-'}</TableCell>
                      <TableCell>{getTypeBadge(customer.type)}</TableCell>
                      <TableCell className="text-right font-medium">
                        ${Number(customer.total_sales).toFixed(2)}
                      </TableCell>
                      <TableCell className="text-right">
                        {getBalanceBadge(Number(customer.balance))}
                      </TableCell>
                      <TableCell>
                        {customer.last_order_date
                          ? new Date(customer.last_order_date).toLocaleDateString()
                          : '-'}
                      </TableCell>
                      <TableCell>{getStatusBadge(customer.status)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {/* Receive Payment button - only show if customer has debt */}
                          {customer.balance > 0 && (
                            <Button
                              variant="outline"
                              size="sm"
                              onClick={() => handleReceivePayment(customer)}
                              className="text-green-600 hover:text-green-700 hover:bg-green-50"
                            >
                              <DollarSign className="h-4 w-4 mr-1" />
                              Receive Payment
                            </Button>
                          )}
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/customers/${customer.id}`)}
                          >
                            <Eye className="h-4 w-4" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => navigate(`/customers/${customer.id}/edit`)}
                          >
                            <Edit className="h-4 w-4" />
                          </Button>
                          <AlertDialog>
                            <AlertDialogTrigger asChild>
                              <Button variant="ghost" size="icon">
                                <Trash2 className="h-4 w-4" />
                              </Button>
                            </AlertDialogTrigger>
                            <AlertDialogContent>
                              <AlertDialogHeader>
                                <AlertDialogTitle>Delete Customer?</AlertDialogTitle>
                                <AlertDialogDescription>
                                  Are you sure you want to delete "{customer.name}"? If this customer has
                                  orders, they will be marked as inactive instead.
                                </AlertDialogDescription>
                              </AlertDialogHeader>
                              <AlertDialogFooter>
                                <AlertDialogCancel>Cancel</AlertDialogCancel>
                                <AlertDialogAction
                                  onClick={() => handleDelete(customer.id, customer.name)}
                                >
                                  Delete
                                </AlertDialogAction>
                              </AlertDialogFooter>
                            </AlertDialogContent>
                          </AlertDialog>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Receive Payment Dialog */}
      {selectedCustomerForPayment && (
        <ReceivePaymentDialog
          open={paymentDialogOpen}
          onOpenChange={setPaymentDialogOpen}
          customer={selectedCustomerForPayment}
          onSuccess={handlePaymentSuccess}
        />
      )}
    </div>
  );
}
