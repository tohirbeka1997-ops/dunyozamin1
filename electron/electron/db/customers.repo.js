"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.listCustomers = listCustomers;
exports.getCustomerById = getCustomerById;
exports.createCustomer = createCustomer;
exports.updateCustomer = updateCustomer;
exports.removeCustomer = removeCustomer;
const index_1 = require("./index");
function listCustomers(params) {
    const database = (0, index_1.getDb)();
    let query = 'SELECT * FROM customers WHERE 1=1';
    const values = [];
    if (params?.search) {
        query += ' AND (name LIKE ? OR phone LIKE ? OR email LIKE ?)';
        const searchPattern = `%${params.search}%`;
        values.push(searchPattern, searchPattern, searchPattern);
    }
    query += ' ORDER BY created_at DESC';
    const rows = database.prepare(query).all(...values);
    return rows.map(row => ({
        ...row,
        allow_debt: row.allow_debt === 1,
    }));
}
function getCustomerById(id) {
    const database = (0, index_1.getDb)();
    const row = database.prepare('SELECT * FROM customers WHERE id = ?').get(id);
    if (!row)
        return null;
    return {
        ...row,
        allow_debt: row.allow_debt === 1,
    };
}
function createCustomer(payload) {
    const database = (0, index_1.getDb)();
    const id = `cust_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = new Date().toISOString();
    const customer = {
        id,
        name: payload.name,
        phone: payload.phone || null,
        email: payload.email || null,
        address: payload.address || null,
        type: payload.type || 'individual',
        company_name: payload.company_name || null,
        tax_number: payload.tax_number || null,
        credit_limit: payload.credit_limit || 0,
        allow_debt: payload.allow_debt || false,
        balance: 0,
        total_sales: 0,
        total_orders: 0,
        last_order_date: null,
        status: 'active',
        notes: payload.notes || null,
        bonus_points: 0,
        created_at: now,
        updated_at: now,
    };
    database.prepare(`
    INSERT INTO customers (
      id, name, phone, email, address, type, company_name, tax_number,
      credit_limit, allow_debt, balance, total_sales, total_orders,
      status, notes, bonus_points, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(customer.id, customer.name, customer.phone, customer.email, customer.address, customer.type, customer.company_name, customer.tax_number, customer.credit_limit, customer.allow_debt ? 1 : 0, customer.balance, customer.total_sales, customer.total_orders, customer.status, customer.notes, customer.bonus_points, customer.created_at, customer.updated_at);
    return customer;
}
function updateCustomer(payload) {
    const database = (0, index_1.getDb)();
    const existing = getCustomerById(payload.id);
    if (!existing) {
        throw new Error(`Customer with id ${payload.id} not found`);
    }
    const updated = {
        ...existing,
        ...payload,
        updated_at: new Date().toISOString(),
    };
    database.prepare(`
    UPDATE customers SET
      name = ?,
      phone = ?,
      email = ?,
      address = ?,
      type = ?,
      company_name = ?,
      tax_number = ?,
      credit_limit = ?,
      allow_debt = ?,
      notes = ?,
      updated_at = ?
    WHERE id = ?
  `).run(updated.name, updated.phone, updated.email, updated.address, updated.type, updated.company_name, updated.tax_number, updated.credit_limit, updated.allow_debt ? 1 : 0, updated.notes, updated.updated_at, updated.id);
    return updated;
}
function removeCustomer(id) {
    const database = (0, index_1.getDb)();
    const result = database.prepare('DELETE FROM customers WHERE id = ?').run(id);
    if (result.changes === 0) {
        throw new Error(`Customer with id ${id} not found`);
    }
}
