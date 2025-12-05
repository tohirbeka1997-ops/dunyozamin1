# POS System - User Guide

## Overview
A professional Point of Sale (POS) management system built with React, TypeScript, Tailwind CSS, and Supabase. This system provides comprehensive features for retail businesses including sales processing, inventory management, customer tracking, and reporting.

## Key Features

### ✅ Implemented Features

#### 1. Authentication & User Management
- **Username/Password Authentication**: Secure login system using Supabase Auth
- **Role-Based Access Control**: Three user roles with different permissions
  - **Admin**: Full system access, can manage users and all features
  - **Manager**: Access to most features except user management
  - **Cashier**: Limited access to POS terminal and basic operations
- **First User Auto-Admin**: The first registered user automatically becomes an admin

#### 2. Dashboard
- Real-time sales statistics
- Today's sales and order count
- Low stock alerts
- Active customer count
- Quick action buttons for common tasks

#### 3. POS Terminal (Core Feature)
- **Product Search**: Search by name, SKU, or barcode
- **Barcode Scanner Support**: Press Enter after scanning to add products
- **Shopping Cart**: Add, remove, and adjust quantities
- **Discount System**: Apply discounts by amount ($) or percentage (%)
- **Customer Selection**: Optional customer assignment for orders
- **Multiple Payment Methods**:
  - Cash (with change calculation)
  - Card
  - QR Payment
  - Mixed payments (split between multiple methods)
- **Shift Management**: Cashiers must open a shift before processing orders
- **Automatic Inventory Updates**: Stock levels update automatically after sales

#### 4. Categories Management
- Create, edit, and delete product categories
- Organize products by category
- Simple and intuitive interface

#### 5. Database & Backend
- **Comprehensive Schema**: 14 tables covering all POS operations
- **Automatic Number Generation**: 
  - Orders: POS-YYYY-######
  - Returns: RET-YYYY-#####
  - Purchase Orders: PRC-YYYY-#####
  - SKU: SKU-YYYYMMDD-####
  - Shifts: SHIFT-YYYY-#####
- **Inventory Tracking**: Automatic stock updates via triggers
- **Audit Trail**: All inventory movements are logged

### 🚧 Placeholder Pages (Ready for Implementation)
The following pages have basic structure and are ready for full implementation:
- Products Management
- Orders/Receipts List
- Sales Returns
- Customers Management
- Inventory Management
- Purchase Orders
- Reports
- Employees Management
- Settings

## Getting Started

### First Time Setup

1. **Register First User (Admin)**
   - Go to the Sign Up tab on the login page
   - Create a username (letters, numbers, and underscores only)
   - Enter a password (minimum 6 characters)
   - This first user will automatically become an admin

2. **Login**
   - Use your username and password to sign in
   - You'll be redirected to the dashboard

3. **Set Up Categories**
   - Navigate to Categories from the sidebar
   - Add product categories (e.g., Electronics, Clothing, Food)

4. **Add Products** (When implemented)
   - Go to Products page
   - Add products with SKU, barcode, prices, and stock levels

5. **Add Customers** (Optional)
   - Go to Customers page
   - Add customer information for tracking purchases

## Using the POS Terminal

### Opening a Shift
1. Navigate to POS Terminal
2. If no shift is open, you'll be prompted to enter opening cash amount
3. Click "Open Shift" to start

### Processing a Sale
1. **Search for Products**:
   - Type product name, SKU, or barcode in the search box
   - Click on a product to add it to cart
   - Or scan a barcode and press Enter

2. **Manage Cart**:
   - Use +/- buttons to adjust quantities
   - Click trash icon to remove items
   - View real-time totals

3. **Apply Discounts** (Optional):
   - Select discount type ($ or %)
   - Enter discount value

4. **Select Customer** (Optional):
   - Choose a customer from the dropdown
   - Or leave as "Walk-in Customer"

5. **Process Payment**:
   - Click "Process Payment"
   - Choose payment method:
     - **Cash**: Enter amount received, system calculates change
     - **Card**: Process card payment
     - **QR Pay**: Process QR payment
     - **Mixed**: Add multiple payment methods

6. **Complete Order**:
   - System generates order number
   - Inventory automatically updates
   - Cart clears for next customer

## User Roles & Permissions

### Admin
- Full access to all features
- Can manage users and assign roles
- Access to all reports and settings

### Manager
- Access to most features
- Can manage products, inventory, and purchase orders
- Access to reports
- Cannot manage users

### Cashier
- Access to POS Terminal
- Can view products and customers
- Can process sales and returns
- Limited access to other features

## Database Structure

### Core Tables
- **profiles**: User accounts with roles
- **categories**: Product categories
- **products**: Product catalog with inventory
- **customers**: Customer information and loyalty data
- **orders**: Sales orders/receipts
- **order_items**: Line items for orders
- **payments**: Payment records (supports split payments)
- **shifts**: Cashier shift tracking
- **inventory_movements**: Complete audit trail of stock changes
- **purchase_orders**: Receiving goods from suppliers
- **sales_returns**: Return processing
- **suppliers**: Supplier information

## Technical Details

### Technology Stack
- **Frontend**: React 18 + TypeScript
- **UI Framework**: shadcn/ui + Tailwind CSS
- **Backend**: Supabase (PostgreSQL)
- **Authentication**: Supabase Auth
- **State Management**: React Context + Hooks
- **Routing**: React Router v6

### Design System
- **Primary Color**: Blue (#2563EB / hsl(217 91% 60%))
- **Secondary Color**: Gray (#64748B / hsl(215 16% 47%))
- **Theme**: Light and Dark mode support
- **Layout**: Desktop-first with mobile responsiveness
- **Touch Support**: Minimum 44px button height for touch screens

### Security
- Username/password authentication (simulated email with @miaoda.com)
- Email verification disabled for simplicity
- Role-based access control at application level
- No RLS policies (for maximum flexibility)
- First user automatically becomes admin

## Future Enhancements

### Planned Features
1. **Products Page**: Full CRUD operations with barcode generation
2. **Orders Page**: View, search, and manage all orders
3. **Sales Returns**: Process returns and refunds
4. **Customers Page**: Customer management with purchase history
5. **Inventory Page**: Stock movements and adjustments
6. **Purchase Orders**: Receive goods from suppliers
7. **Reports**: 
   - Sales reports (daily, by cashier, by product)
   - Inventory reports
   - Financial reports (P&L)
   - Customer reports
   - Shift reports (Z-report, X-report)
8. **Employees Page**: User management for admins
9. **Settings**: System configuration
10. **Hold Orders**: Save incomplete orders for later
11. **Receipt Printing**: Generate and print receipts
12. **Barcode Scanner Integration**: Hardware barcode scanner support

## Troubleshooting

### Cannot Login
- Ensure username contains only letters, numbers, and underscores
- Password must be at least 6 characters
- Check that you've registered an account first

### Shift Not Opening
- Ensure you've entered a valid opening cash amount
- Check your internet connection
- Try refreshing the page

### Products Not Adding to Cart
- Ensure products exist in the database
- Check that products are marked as active
- Verify product has stock available

### Payment Not Processing
- Ensure shift is open
- Verify cart is not empty
- Check that payment amount is sufficient
- Ensure internet connection is stable

## Support & Development

This POS system is built with modern web technologies and follows best practices for:
- Clean code architecture
- Type safety with TypeScript
- Responsive design
- Accessibility
- Performance optimization

For technical support or feature requests, please contact your system administrator.

---

**Version**: 1.0.0  
**Last Updated**: December 2025  
**Built with**: React + TypeScript + Supabase + shadcn/ui
