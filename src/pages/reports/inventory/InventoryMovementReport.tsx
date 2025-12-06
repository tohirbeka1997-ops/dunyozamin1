import { useState, useEffect } from 'react';
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
import { getAllInventoryMovements } from '@/db/api';
import type { InventoryMovementWithDetails } from '@/types/database';
import { FileDown, ArrowLeft, TrendingUp, TrendingDown } from 'lucide-react';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import { format } from 'date-fns';

export default function InventoryMovementReport() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [movements, setMovements] = useState<InventoryMovementWithDetails[]>([]);
  const [loading, setLoading] = useState(true);
  const [dateFrom, setDateFrom] = useState(new Date().toISOString().split('T')[0]);
  const [dateTo, setDateTo] = useState(new Date().toISOString().split('T')[0]);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchTerm, setSearchTerm] = useState('');

  useEffect(() => {
    loadData();
  }, [dateFrom, dateTo, typeFilter]);

  const loadData = async () => {
    try {
      setLoading(true);
      const movementsData = await getAllInventoryMovements({
        startDate: dateFrom,
        endDate: dateTo,
        movementType: typeFilter,
      });
      
      setMovements(movementsData);
    } catch (error) {
      toast({
        title: 'Error',
        description: 'Failed to load inventory movements',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const filteredMovements = movements.filter((movement) => {
    if (!searchTerm) return true;
    const search = searchTerm.toLowerCase();
    const productName = movement.product?.name || '';
    return (
      productName.toLowerCase().includes(search) ||
      (movement.reference_type && movement.reference_type.toLowerCase().includes(search))
    );
  });

  const getMovementTypeBadge = (type: string) => {
    const types: Record<string, { label: string; className: string }> = {
      sale: { label: 'Sale', className: 'bg-primary' },
      purchase: { label: 'Purchase', className: 'bg-success' },
      adjustment: { label: 'Adjustment', className: 'bg-warning' },
      return: { label: 'Return', className: 'bg-secondary' },
    };
    return types[type] || { label: type, className: 'bg-muted' };
  };

  const handleExport = (format: 'excel' | 'pdf') => {
    toast({
      title: 'Export',
      description: `Exporting to ${format.toUpperCase()}...`,
    });
  };

  if (loading) {
    return (
      <div className="flex justify-center items-center min-h-[400px]">
        <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <Button variant="ghost" size="icon" onClick={() => navigate('/reports')}>
            <ArrowLeft className="h-4 w-4" />
          </Button>
          <div>
            <h1 className="text-3xl font-bold">Inventory Movement Report</h1>
            <p className="text-muted-foreground">Track all stock movements and changes</p>
          </div>
        </div>
        <div className="flex gap-2">
          <Button variant="outline" onClick={() => handleExport('excel')}>
            <FileDown className="h-4 w-4 mr-2" />
            Excel
          </Button>
          <Button variant="outline" onClick={() => handleExport('pdf')}>
            <FileDown className="h-4 w-4 mr-2" />
            PDF
          </Button>
        </div>
      </div>

      <Card>
        <CardContent className="pt-6">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            <div>
              <label className="text-sm text-muted-foreground">From Date</label>
              <Input
                type="date"
                value={dateFrom}
                onChange={(e) => setDateFrom(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">To Date</label>
              <Input
                type="date"
                value={dateTo}
                onChange={(e) => setDateTo(e.target.value)}
              />
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Movement Type</label>
              <Select value={typeFilter} onValueChange={setTypeFilter}>
                <SelectTrigger>
                  <SelectValue placeholder="All Types" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Types</SelectItem>
                  <SelectItem value="sale">Sale</SelectItem>
                  <SelectItem value="purchase">Purchase</SelectItem>
                  <SelectItem value="adjustment">Adjustment</SelectItem>
                  <SelectItem value="return">Return</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div>
              <label className="text-sm text-muted-foreground">Search</label>
              <Input
                placeholder="Search by product or reference..."
                value={searchTerm}
                onChange={(e) => setSearchTerm(e.target.value)}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {filteredMovements.length === 0 ? (
            <div className="text-center py-12">
              <p className="text-muted-foreground">No inventory movements found</p>
            </div>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Date</TableHead>
                  <TableHead>Product</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead className="text-right">Quantity Change</TableHead>
                  <TableHead className="text-right">Before</TableHead>
                  <TableHead className="text-right">After</TableHead>
                  <TableHead>Reference</TableHead>
                  <TableHead>Performed By</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {filteredMovements.map((movement) => {
                  const badge = getMovementTypeBadge(movement.movement_type);
                  const isIncrease = Number(movement.quantity) > 0;
                  
                  return (
                    <TableRow key={movement.id}>
                      <TableCell>
                        {format(new Date(movement.created_at), 'MMM dd, yyyy HH:mm')}
                      </TableCell>
                      <TableCell className="font-medium">
                        {movement.product?.name || 'Unknown Product'}
                      </TableCell>
                      <TableCell>
                        <Badge className={badge.className}>{badge.label}</Badge>
                      </TableCell>
                      <TableCell className={`text-right ${isIncrease ? 'text-success' : 'text-destructive'}`}>
                        <div className="flex items-center justify-end gap-1">
                          {isIncrease ? (
                            <TrendingUp className="h-4 w-4" />
                          ) : (
                            <TrendingDown className="h-4 w-4" />
                          )}
                          {isIncrease ? '+' : ''}{Number(movement.quantity)}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">{Number(movement.before_quantity)}</TableCell>
                      <TableCell className="text-right">{Number(movement.after_quantity)}</TableCell>
                      <TableCell>
                        {movement.reference_type || '-'}
                      </TableCell>
                      <TableCell>
                        {movement.user?.full_name || 'System'}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
