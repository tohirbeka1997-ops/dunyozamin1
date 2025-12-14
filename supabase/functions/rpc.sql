CREATE OR REPLACE FUNCTION generate_order_number(p_store_id uuid)
RETURNS text AS $$
DECLARE
  v_year text;
  v_seq integer;
  v_number text;
BEGIN
  v_year := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(
    (regexp_match(order_number, '^POS-' || v_year || '-(\d+)$'))[1]::integer
  ), 0) + 1
  INTO v_seq
  FROM orders
  WHERE store_id = p_store_id
    AND order_number LIKE 'POS-' || v_year || '-%';
  v_number := 'POS-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_payment_number(p_store_id uuid)
RETURNS text AS $$
DECLARE
  v_year text;
  v_seq integer;
  v_number text;
BEGIN
  v_year := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(
    (regexp_match(payment_number, '^PAY-' || v_year || '-(\d+)$'))[1]::integer
  ), 0) + 1
  INTO v_seq
  FROM payments
  WHERE store_id = p_store_id
    AND payment_number LIKE 'PAY-' || v_year || '-%';
  v_number := 'PAY-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_return_number(p_store_id uuid)
RETURNS text AS $$
DECLARE
  v_year text;
  v_seq integer;
  v_number text;
BEGIN
  v_year := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(
    (regexp_match(return_number, '^RET-' || v_year || '-(\d+)$'))[1]::integer
  ), 0) + 1
  INTO v_seq
  FROM sales_returns
  WHERE store_id = p_store_id
    AND return_number LIKE 'RET-' || v_year || '-%';
  v_number := 'RET-' || v_year || '-' || lpad(v_seq::text, 5, '0');
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION generate_movement_number(p_store_id uuid)
RETURNS text AS $$
DECLARE
  v_year text;
  v_seq integer;
  v_number text;
BEGIN
  v_year := to_char(now(), 'YYYY');
  SELECT COALESCE(MAX(
    (regexp_match(movement_number, '^INV-' || v_year || '-(\d+)$'))[1]::integer
  ), 0) + 1
  INTO v_seq
  FROM inventory_movements
  WHERE store_id = p_store_id
    AND movement_number LIKE 'INV-' || v_year || '-%';
  v_number := 'INV-' || v_year || '-' || lpad(v_seq::text, 6, '0');
  RETURN v_number;
END;
$$ LANGUAGE plpgsql;

CREATE OR REPLACE FUNCTION rpc_complete_sale(
  p_store_id uuid,
  p_cashier_user_id uuid,
  p_items jsonb,
  p_payments jsonb,
  p_location_id uuid DEFAULT NULL,
  p_customer_id uuid DEFAULT NULL,
  p_discount numeric DEFAULT 0,
  p_discount_percent numeric DEFAULT 0,
  p_tax_amount numeric DEFAULT 0,
  p_notes text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_order_id uuid;
  v_order_number text;
  v_item jsonb;
  v_payment jsonb;
  v_product_stock numeric;
  v_product_name text;
  v_allow_negative text;
  v_shift_id uuid;
  v_subtotal numeric(18,2) := 0;
  v_total_amount numeric(18,2);
  v_paid_amount numeric(18,2) := 0;
  v_credit_amount numeric(18,2) := 0;
  v_change_amount numeric(18,2) := 0;
  v_payment_status payment_status;
  v_movement_number text;
  v_before_qty numeric(18,3);
  v_after_qty numeric(18,3);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_members WHERE store_id = p_store_id AND user_id = p_cashier_user_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User is not a member of this store');
  END IF;
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'Cart is empty');
  END IF;
  IF p_location_id IS NOT NULL THEN
    SELECT id INTO v_shift_id
    FROM shifts
    WHERE store_id = p_store_id
      AND location_id = p_location_id
      AND cashier_id = p_cashier_user_id
      AND status = 'open'
    ORDER BY opened_at DESC
    LIMIT 1;
    IF v_shift_id IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'Shift must be open to complete sales');
    END IF;
  END IF;
  SELECT COALESCE(
    (SELECT value::text FROM settings WHERE store_id = p_store_id AND category = 'inventory' AND key = 'allow_negative_stock'),
    '"block"'
  ) INTO v_allow_negative;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT quantity, (SELECT name FROM products WHERE id = (v_item->>'product_id')::uuid) INTO v_product_stock, v_product_name
    FROM inventory_balances
    WHERE store_id = p_store_id
      AND product_id = (v_item->>'product_id')::uuid
      AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
    IF v_product_stock IS NULL THEN
      v_product_stock := 0;
    END IF;
    IF (v_item->>'quantity')::numeric > v_product_stock AND v_allow_negative = '"block"' THEN
      RETURN jsonb_build_object('success', false, 'error', format('Insufficient stock for %s. Available: %s, Requested: %s', v_product_name, v_product_stock, (v_item->>'quantity')::numeric));
    END IF;
  END LOOP;
  SELECT COALESCE(SUM((item->>'total')::numeric), 0) INTO v_subtotal
  FROM jsonb_array_elements(p_items) AS item;
  v_total_amount := v_subtotal - p_discount + p_tax_amount;
  SELECT COALESCE(SUM((payment->>'amount')::numeric), 0) INTO v_paid_amount
  FROM jsonb_array_elements(p_payments) AS payment
  WHERE (payment->>'payment_method')::text != 'credit';
  SELECT COALESCE(SUM((payment->>'amount')::numeric), 0) INTO v_credit_amount
  FROM jsonb_array_elements(p_payments) AS payment
  WHERE (payment->>'payment_method')::text = 'credit';
  IF v_paid_amount + v_credit_amount >= v_total_amount THEN
    v_payment_status := 'paid';
    v_change_amount := GREATEST(0, v_paid_amount - (v_total_amount - v_credit_amount));
  ELSIF v_paid_amount + v_credit_amount > 0 THEN
    v_payment_status := 'partially_paid';
  ELSE
    v_payment_status := 'on_credit';
  END IF;
  v_order_number := generate_order_number(p_store_id);
  INSERT INTO orders (
    store_id, location_id, order_number, customer_id, cashier_id, shift_id,
    subtotal, discount_amount, discount_percent, tax_amount, total_amount,
    paid_amount, credit_amount, change_amount, status, payment_status, notes
  ) VALUES (
    p_store_id, p_location_id, v_order_number, p_customer_id, p_cashier_user_id, v_shift_id,
    v_subtotal, p_discount, p_discount_percent, p_tax_amount, v_total_amount,
    v_paid_amount, v_credit_amount, v_change_amount, 'completed', v_payment_status, p_notes
  ) RETURNING id INTO v_order_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    INSERT INTO order_items (
      order_id, product_id, product_name, quantity, unit_price, subtotal, discount_amount, total
    ) VALUES (
      v_order_id,
      (v_item->>'product_id')::uuid,
      v_item->>'product_name',
      (v_item->>'quantity')::numeric,
      (v_item->>'unit_price')::numeric,
      (v_item->>'subtotal')::numeric,
      (v_item->>'discount_amount')::numeric,
      (v_item->>'total')::numeric
    );
    SELECT COALESCE(quantity, 0) INTO v_before_qty
    FROM inventory_balances
    WHERE store_id = p_store_id
      AND product_id = (v_item->>'product_id')::uuid
      AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_after_qty := v_before_qty - (v_item->>'quantity')::numeric;
    v_movement_number := generate_movement_number(p_store_id);
    INSERT INTO inventory_movements (
      store_id, location_id, movement_number, product_id, movement_type,
      quantity, before_quantity, after_quantity,
      reference_type, reference_id, reason, created_by
    ) VALUES (
      p_store_id, p_location_id, v_movement_number, (v_item->>'product_id')::uuid, 'sale',
      -(v_item->>'quantity')::numeric,
      v_before_qty, v_after_qty,
      'order', v_order_id, format('POS sale - Order %s', v_order_number), p_cashier_user_id
    );
  END LOOP;
  FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
  LOOP
    INSERT INTO payments (
      store_id, payment_number, order_id, payment_method, amount, reference_number, notes
    ) VALUES (
      p_store_id,
      generate_payment_number(p_store_id),
      v_order_id,
      (v_payment->>'payment_method')::payment_method,
      (v_payment->>'amount')::numeric,
      v_payment->>'reference_number',
      v_payment->>'notes'
    );
  END LOOP;
  IF p_customer_id IS NOT NULL AND v_credit_amount > 0 THEN
    UPDATE customers
    SET balance = balance + v_credit_amount,
        total_sales = total_sales + v_total_amount,
        total_orders = total_orders + 1,
        last_order_date = now(),
        updated_at = now()
    WHERE id = p_customer_id;
  ELSIF p_customer_id IS NOT NULL THEN
    UPDATE customers
    SET total_sales = total_sales + v_total_amount,
        total_orders = total_orders + 1,
        last_order_date = now(),
        updated_at = now()
    WHERE id = p_customer_id;
  END IF;
  INSERT INTO ledger_entries (
    store_id, entry_type, reference_type, reference_id,
    debit, description, created_by
  ) VALUES (
    p_store_id, 'SALE', 'order', v_order_id,
    v_total_amount, format('Sale: Order %s', v_order_number), p_cashier_user_id
  );
  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_number', v_order_number,
    'total_amount', v_total_amount,
    'paid_amount', v_paid_amount,
    'credit_amount', v_credit_amount,
    'change_amount', v_change_amount,
    'payment_status', v_payment_status
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_receive_purchase(
  p_store_id uuid,
  p_purchase_order_id uuid,
  p_items jsonb,
  p_received_by uuid,
  p_location_id uuid DEFAULT NULL,
  p_payments jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_item jsonb;
  v_payment jsonb;
  v_po_item record;
  v_product_id uuid;
  v_received_qty numeric(18,3);
  v_before_qty numeric(18,3);
  v_after_qty numeric(18,3);
  v_movement_number text;
  v_total_received numeric(18,2) := 0;
  v_po_status purchase_order_status;
  v_po_number text;
  v_supplier_id uuid;
  v_payment_number text;
  v_payment_seq integer;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_members WHERE store_id = p_store_id AND user_id = p_received_by AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User is not a member of this store');
  END IF;
  SELECT status, po_number, supplier_id INTO v_po_status, v_po_number, v_supplier_id
  FROM purchase_orders
  WHERE id = p_purchase_order_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Purchase order not found');
  END IF;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    SELECT poi.*, p.id as product_id
    INTO v_po_item
    FROM purchase_order_items poi
    JOIN products p ON p.id = poi.product_id
    WHERE poi.id = (v_item->>'item_id')::uuid
      AND poi.purchase_order_id = p_purchase_order_id;
    IF NOT FOUND THEN
      CONTINUE;
    END IF;
    v_received_qty := (v_item->>'received_qty')::numeric;
    v_product_id := v_po_item.product_id;
    IF v_po_item.received_qty + v_received_qty > v_po_item.ordered_qty THEN
      RETURN jsonb_build_object('success', false, 'error', format('Received quantity exceeds ordered quantity for %s', v_po_item.product_name));
    END IF;
    UPDATE purchase_order_items
    SET received_qty = received_qty + v_received_qty
    WHERE id = v_po_item.id;
    SELECT COALESCE(quantity, 0) INTO v_before_qty
    FROM inventory_balances
    WHERE store_id = p_store_id
      AND product_id = v_product_id
      AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_after_qty := v_before_qty + v_received_qty;
    v_movement_number := generate_movement_number(p_store_id);
    v_total_received := v_total_received + (v_po_item.unit_cost * v_received_qty);
    INSERT INTO inventory_movements (
      store_id, location_id, movement_number, product_id, movement_type,
      quantity, before_quantity, after_quantity,
      reference_type, reference_id, reason, created_by
    ) VALUES (
      p_store_id, p_location_id, v_movement_number, v_product_id, 'purchase',
      v_received_qty, v_before_qty, v_after_qty,
      'purchase_order', p_purchase_order_id, format('Received goods - PO %s', v_po_number), p_received_by
    );
  END LOOP;
  UPDATE purchase_orders
  SET status = CASE
    WHEN (SELECT SUM(ordered_qty) FROM purchase_order_items WHERE purchase_order_id = p_purchase_order_id) =
         (SELECT SUM(received_qty) FROM purchase_order_items WHERE purchase_order_id = p_purchase_order_id)
    THEN 'received'::purchase_order_status
    ELSE 'partially_received'::purchase_order_status
  END,
  received_by = p_received_by,
  updated_at = now()
  WHERE id = p_purchase_order_id;
  IF p_payments IS NOT NULL THEN
    SELECT COALESCE(MAX((regexp_match(payment_number, '^PAY-' || to_char(now(), 'YYYY') || '-(\d+)$'))[1]::integer), 0) + 1
    INTO v_payment_seq
    FROM supplier_payments
    WHERE store_id = p_store_id
      AND payment_number LIKE 'PAY-' || to_char(now(), 'YYYY') || '-%';
    FOR v_payment IN SELECT * FROM jsonb_array_elements(p_payments)
    LOOP
      v_payment_number := 'PAY-' || to_char(now(), 'YYYY') || '-' || lpad(v_payment_seq::text, 6, '0');
      v_payment_seq := v_payment_seq + 1;
      INSERT INTO supplier_payments (
        store_id, payment_number, supplier_id, purchase_order_id,
        amount, payment_method, paid_at, note, created_by
      ) VALUES (
        p_store_id,
        v_payment_number,
        v_supplier_id,
        p_purchase_order_id,
        (v_payment->>'amount')::numeric,
        (v_payment->>'payment_method')::supplier_payment_method,
        COALESCE((v_payment->>'paid_at')::timestamptz, now()),
        v_payment->>'note',
        p_received_by
      );
    END LOOP;
  END IF;
  INSERT INTO ledger_entries (
    store_id, entry_type, reference_type, reference_id,
    credit, description, created_by
  ) VALUES (
    p_store_id, 'PURCHASE', 'purchase_order', p_purchase_order_id,
    v_total_received, format('Purchase: PO %s', v_po_number), p_received_by
  );
  RETURN jsonb_build_object(
    'success', true,
    'purchase_order_id', p_purchase_order_id,
    'total_received', v_total_received
  );
END;
$$;

CREATE OR REPLACE FUNCTION rpc_return_sale(
  p_store_id uuid,
  p_order_id uuid,
  p_items jsonb,
  p_reason text,
  p_cashier_id uuid,
  p_location_id uuid DEFAULT NULL,
  p_refund_payments jsonb DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_return_id uuid;
  v_return_number text;
  v_item jsonb;
  v_total_amount numeric(18,2) := 0;
  v_product_id uuid;
  v_return_qty numeric(18,3);
  v_before_qty numeric(18,3);
  v_after_qty numeric(18,3);
  v_movement_number text;
  v_customer_id uuid;
  v_order_total numeric(18,2);
BEGIN
  IF NOT EXISTS (SELECT 1 FROM store_members WHERE store_id = p_store_id AND user_id = p_cashier_id AND is_active = true) THEN
    RETURN jsonb_build_object('success', false, 'error', 'User is not a member of this store');
  END IF;
  SELECT customer_id, total_amount INTO v_customer_id, v_order_total
  FROM orders
  WHERE id = p_order_id AND store_id = p_store_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'Order not found');
  END IF;
  v_return_number := generate_return_number(p_store_id);
  SELECT COALESCE(SUM((item->>'line_total')::numeric), 0) INTO v_total_amount
  FROM jsonb_array_elements(p_items) AS item;
  INSERT INTO sales_returns (
    store_id, location_id, return_number, order_id, customer_id, cashier_id,
    total_amount, refund_method, reason, status
  ) VALUES (
    p_store_id, p_location_id, v_return_number, p_order_id, v_customer_id, p_cashier_id,
    v_total_amount, 'cash', p_reason, 'completed'
  ) RETURNING id INTO v_return_id;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_product_id := (v_item->>'product_id')::uuid;
    v_return_qty := (v_item->>'quantity')::numeric;
    INSERT INTO sales_return_items (
      return_id, product_id, quantity, unit_price, line_total
    ) VALUES (
      v_return_id, v_product_id, v_return_qty,
      (v_item->>'unit_price')::numeric,
      (v_item->>'line_total')::numeric
    );
    SELECT COALESCE(quantity, 0) INTO v_before_qty
    FROM inventory_balances
    WHERE store_id = p_store_id
      AND product_id = v_product_id
      AND COALESCE(location_id, '00000000-0000-0000-0000-000000000000'::uuid) = COALESCE(p_location_id, '00000000-0000-0000-0000-000000000000'::uuid);
    v_after_qty := v_before_qty + v_return_qty;
    v_movement_number := generate_movement_number(p_store_id);
    INSERT INTO inventory_movements (
      store_id, location_id, movement_number, product_id, movement_type,
      quantity, before_quantity, after_quantity,
      reference_type, reference_id, reason, created_by
    ) VALUES (
      p_store_id, p_location_id, v_movement_number, v_product_id, 'sale_return_in',
      v_return_qty, v_before_qty, v_after_qty,
      'return', v_return_id, format('Sales return - Return %s', v_return_number), p_cashier_id
    );
  END LOOP;
  IF v_customer_id IS NOT NULL THEN
    UPDATE customers
    SET balance = GREATEST(0, balance - v_total_amount),
        updated_at = now()
    WHERE id = v_customer_id;
  END IF;
  INSERT INTO ledger_entries (
    store_id, entry_type, reference_type, reference_id,
    credit, description, created_by
  ) VALUES (
    p_store_id, 'RETURN', 'return', v_return_id,
    v_total_amount, format('Sales return: Return %s', v_return_number), p_cashier_id
  );
  RETURN jsonb_build_object(
    'success', true,
    'return_id', v_return_id,
    'return_number', v_return_number,
    'total_amount', v_total_amount
  );
END;
$$;

CREATE SEQUENCE IF NOT EXISTS payment_seq START 1;
