# Categories Module Guide

## Overview
The Categories module provides comprehensive category management functionality for the POS system, including visual customization, hierarchical structure, and product tracking.

## Features Implemented

### 1. Category Management
- **Create/Edit/Delete** categories with full CRUD operations
- **Visual Customization**: Color tags and emoji icons for easy identification
- **Hierarchical Structure**: Support for parent-child category relationships
- **Product Tracking**: Real-time product count for each category
- **Delete Protection**: Prevents deletion of categories containing products

### 2. Category List Page (`/categories`)
**Location**: `src/pages/Categories.tsx`

**Features**:
- Display all categories in a table format
- Search by category name or description
- Sort options:
  - Name (A-Z)
  - Name (Z-A)
  - Newest First
  - Oldest First
- Visual indicators:
  - Color-coded category badges
  - Emoji icons
  - Parent category badges
  - Product count display
- Action buttons:
  - View details (eye icon)
  - Edit category (pencil icon)
  - Delete category (trash icon)

**UI Components**:
- Search input with icon
- Sort dropdown
- Data table with columns:
  - Category (with icon and color)
  - Description
  - Parent Category
  - Products count
  - Created date
  - Actions

### 3. Category Form Dialog
**Features**:
- Modal dialog for creating/editing categories
- Form fields:
  - **Name** (required): Category name
  - **Description** (optional): Detailed description
  - **Icon** (optional): Emoji icon (max 2 characters)
  - **Color** (optional): Hex color picker
  - **Parent Category** (optional): Select from existing categories
- Validation:
  - Name is required
  - Prevents circular parent relationships
  - Shows product count warning when editing

### 4. Category Detail Page (`/categories/:id`)
**Location**: `src/pages/CategoryDetail.tsx`

**Features**:
- Category information display with color and icon
- Statistics cards:
  - Total Products
  - Total Value (inventory value)
  - In Stock (products above min stock)
  - Low Stock (products at or below min stock)
- Products table:
  - Product name with image
  - SKU and barcode
  - Sale price
  - Current stock
  - Stock status badges (In Stock/Low Stock/Out of Stock)
  - View product button
- Breadcrumb navigation
- Edit category button

## Database Schema

### Categories Table
```sql
CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  description text,
  color text,              -- Hex color code (e.g., #2563EB)
  icon text,               -- Emoji or icon identifier
  parent_id uuid REFERENCES categories(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX idx_categories_parent_id ON categories(parent_id);
```

## API Functions

### Category Operations
**Location**: `src/db/api.ts`

```typescript
// Get all categories
getCategories(): Promise<Category[]>

// Get category by ID
getCategoryById(id: string): Promise<Category>

// Create new category
createCategory(data: Omit<Category, 'id' | 'created_at'>): Promise<void>

// Update category
updateCategory(id: string, data: Partial<Category>): Promise<void>

// Delete category
deleteCategory(id: string): Promise<void>

// Get product count for category
getCategoryProductCount(categoryId: string): Promise<number>

// Get products by category
getProductsByCategoryId(categoryId: string): Promise<Product[]>
```

## Type Definitions

### Category Interface
**Location**: `src/types/database.ts`

```typescript
export interface Category {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  icon: string | null;
  parent_id: string | null;
  created_at: string;
}
```

## User Workflows

### Creating a Category
1. Click "Add Category" button
2. Fill in category name (required)
3. Optionally add description, icon, color, and parent category
4. Click "Create" to save
5. Category appears in the list with visual indicators

### Editing a Category
1. Click the pencil icon on a category row
2. Modify the desired fields
3. Click "Update" to save changes
4. Changes are reflected immediately in the list

### Deleting a Category
1. Click the trash icon on a category row
2. System checks if category has products
3. If products exist, deletion is blocked with error message
4. If no products, confirmation dialog appears
5. Confirm deletion to remove category

### Viewing Category Details
1. Click the eye icon on a category row
2. View category information and statistics
3. See all products in the category
4. Click "Edit Category" to modify
5. Click product names to view product details

## Integration with Products Module

### Product Form
- Category dropdown shows all categories with icons
- Selecting a category associates the product with it
- Category field is optional

### Product List
- Filter products by category
- Display category name with products
- Category badge shows color and icon

### Category Detail
- Shows all products in the category
- Real-time stock status
- Quick navigation to product details

## Validation Rules

### Category Creation/Update
1. **Name**: Required, cannot be empty
2. **Parent Category**: Cannot be the same as the category being edited
3. **Circular References**: Prevented through validation
4. **Color**: Must be valid hex color code
5. **Icon**: Limited to 2 characters (emoji support)

### Category Deletion
1. **Product Check**: Cannot delete if products exist
2. **Child Categories**: Can delete even if child categories exist (parent_id set to NULL)

## UI/UX Features

### Visual Design
- Color-coded category badges for quick identification
- Emoji icons for visual appeal
- Consistent card-based layout
- Responsive design for all screen sizes

### User Feedback
- Toast notifications for all operations
- Loading spinners during data fetch
- Empty state with call-to-action
- Product count warnings
- Validation error messages

### Navigation
- Breadcrumb navigation on detail page
- Quick action buttons in table
- Back button on detail page
- Seamless integration with main navigation

## Best Practices

### Performance
- Efficient product count queries
- Optimized table rendering
- Lazy loading of category details
- Indexed database queries

### Data Integrity
- Foreign key constraints
- Cascade delete prevention
- Null handling for optional fields
- Transaction safety

### User Experience
- Intuitive form layout
- Clear error messages
- Confirmation dialogs for destructive actions
- Visual feedback for all operations

## Future Enhancements

### Potential Features
1. Bulk category operations
2. Category import/export
3. Category analytics and insights
4. Custom category attributes
5. Category-based pricing rules
6. Multi-level category hierarchy visualization
7. Category templates
8. Category merge functionality

## Troubleshooting

### Common Issues

**Issue**: Category not appearing in product dropdown
- **Solution**: Refresh the page or check if category was successfully created

**Issue**: Cannot delete category
- **Solution**: Check if category has products, move or delete products first

**Issue**: Parent category not showing
- **Solution**: Ensure parent category exists and is not the same as current category

**Issue**: Color not displaying
- **Solution**: Verify color is valid hex code format (#RRGGBB)

## Related Modules
- **Products Module**: Product-category associations
- **Inventory Module**: Category-based stock tracking
- **Reports Module**: Category-based sales reports
- **POS Terminal**: Category-based product filtering
