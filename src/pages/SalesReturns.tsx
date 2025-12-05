import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
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
import { getSalesReturns, getCustomers } from '@/db/api';
import type { Customer } from '@/types/database';
import { Plus, Search, Eye, Printer, RotateCcw } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';

export default function SalesReturns() {
  const { toast } = useToast();
  const navigate = useNavigate();
  const [returns, setReturns] = useState<any[]>([]);
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState('all');
  const [selectedStatus, setSelectedStatus] = useState('all');

  useEffect(() => {
    loadData();
  }, []);

  const loadData = async () => {
    try {
      setLoading(true);
      const [returnsData, customersData] = await Promise.all([
        getSalesReturns(),
        getCustomers(),
      ]);
      setReturns(returnsData);
      setCustomers(customersData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load sales returns',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = async () => {
    try {
      setLoading(true);
      const filters: any = {};
      
      if (startDate) filters.startDate = new Date(startDate).toISOString();
      if (endDate) filters.endDate = new Date(endDate).toISOString();
      if (selectedCustomer !== 'all') filters.customerId = selectedCustomer;
      if (selectedStatus !== 'all') filters.status = selectedStatus;
      
      const data = await getSalesReturns(filters);
      setReturns(data);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to search returns',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'Completed':
        return <Badge className="bg-success text-success-foreground">Completed</Badge>;
      case 'Pending':
        return <Badge className="bg-primary text-primary-foreground">Pending</Badge>;
      case 'Cancelled':
        return <Badge variant="destructive">Cancelled</Badge>;
      default:
        return <Badge variant="outline">{status}</Badge>;
    }
  };

  const filteredReturns = returns.filter((ret) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    return (
      ret.return_number?.toLowerCase().includes(search) ||
      ret.order?.order_number?.toLowerCase().includes(search) ||
      ret.customer?.name?.toLowerCase().includes(search)
    );
  });

  const totalReturned = filteredReturns.reduce((sum, ret) => sum + Number(ret.total_amount || 0), 0);
  const completedReturns = filteredReturns.filter(ret => ret.status === 'Completed').length;
  const pendingReturns = filteredReturns.filter(ret => ret.status === 'Pending').length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-3xl font-bold">Sales Returns</h1>
          <p className="text-muted-foreground">Manage product returns and refunds</p>
        </div>
        <Button onClick={() => navigate('/sales-returns/create')}>
          <Plus className="h-4 w-4 mr-2" />
          New Sales Return
        </Button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Total Returned</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">${totalReturned.toFixed(2)}</div>
            <p className="text-xs text-muted-foreground">{filteredReturns.length} returns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Completed</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{completedReturns}</div>
            <p className="text-xs text-muted-foreground">Processed returns</p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
            <CardTitle className="text-sm font-medium">Pending</CardTitle>
            <RotateCcw className="h-4 w-4 text-muted-foreground" />
          </CardHeader>
          <CardContent>
            <div className="text-2xl font-bold">{pendingReturns}</div>
            <p className="text-xs text-muted-foreground">Awaiting processing</p>
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Filters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-4">
            <div className="relative">
              <Search className="absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
              <Input
                placeholder="Search returns..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
                className="pl-9"
              />
            </div>

            <Input
              type="date"
              value={startDate}
              onChange={(e) => setStartDate(e.target.value)}
              placeholder="Start Date"
            />

            <Input
              type="date"
              value={endDate}
              onChange={(e) => setEndDate(e.target.value)}
              placeholder="End Date"
            />

            <Select value={selectedCustomer} onValueChange={setSelectedCustomer}>
              <SelectTrigger>
                <SelectValue placeholder="All Customers" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Customers</SelectItem>
                {customers.map((customer) => (
                  <SelectItem key={customer.id} value={customer.id}>
                    {customer.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>

            <Select value={selectedStatus} onValueChange={setSelectedStatus}>
              <SelectTrigger>
                <SelectValue placeholder="All Status" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Status</SelectItem>
                <SelectItem value="Pending">Pending</SelectItem>
                <SelectItem value="Completed">Completed</SelectItem>
                <SelectItem value="Cancelled">Cancelled</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div className="flex justify-end gap-2 mt-4">
            <Button
              variant="outline"
              onClick={() => {
                setSearchTerm('');
                setStartDate('');
                setEndDate('');
                setSelectedCustomer('all');
                setSelectedStatus('all');
                loadData();
              }}
            >
              Reset
            </Button>
            <Button onClick={handleSearch}>Apply Filters</Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Returns List ({filteredReturns.length})</CardTitle>
        </CardHeader>
        <CardContent>
          {loading ? (
            <div className="flex justify-center py-8">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
            </div>
          ) : filteredReturns.length === 0 ? (
            <div className="text-center py-12">
              <RotateCcw className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
              <p className="text-muted-foreground">No returns found</p>
              <Button className="mt-4" onClick={() => navigate('/sales-returns/create')}>
                <Plus className="h-4 w-4 mr-2" />
                Create First Return
              </Button>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Return Number</TableHead>
                  <TableHead>Order Number</TableHead>
                  <TableHead>Customer</TableHead>
                  <TableHead>Date & Time</TableHead>
                  <TableHead className="text-right">Amount</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Cashier</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredReturns.map((ret) => (
                  <TableRow key={ret.id}>
                    <TableCell className="font-medium">{ret.return_number}</TableCell>
                    <TableCell>{ret.order?.order_number || '-'}</TableCell>
                    <TableCell>{ret.customer?.name || 'Walk-in'}</TableCell>
                    <TableCell>
                      {new Date(ret.created_at).toLocaleString()}
                    </TableCell>
                    <TableCell className="text-right font-medium">
                      ${Number(ret.total_amount).toFixed(2)}
                    </TableCell>
                    <TableCell>{getStatusBadge(ret.status)}</TableCell>
                    <TableCell>{ret.cashier?.username || '-'}</TableCell>
                    <TableCell className="text-right">
                      <div className="flex items-center justify-end gap-1">
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => navigate(`/sales-returns/${ret.id}`)}
                        >
                          <Eye className="h-4 w-4" />
                        </Button>
                        <Button
                          variant="ghost"
                          size="icon"
                          onClick={() => {
                            toast({
                              title: 'Print',
                              description: 'Print functionality coming soon',
                            });
                          }}
                        >
                          <Printer className="h-4 w-4" />
                        </Button>
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
