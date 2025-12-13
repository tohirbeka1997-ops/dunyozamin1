# Offline Mode & Auto Sync

## Overview

The POS system now supports full offline functionality with automatic synchronization when the connection is restored. This ensures that the system continues to work even when internet connectivity is lost, and all changes are automatically synced when the connection is restored.

## Features

### ✅ Offline Capabilities

- **Full POS Operations**: Add to cart, complete sales, hold orders, create returns, update inventory - all work offline
- **No Data Loss**: All offline changes are persisted locally and automatically synced when online
- **Optimistic Updates**: UI updates immediately, even when offline
- **Automatic Sync**: Background sync engine processes pending changes automatically

### ✅ Connection Status

- **Real-time Status**: Network badge in header shows current connection status
- **Visual Indicators**:
  - 🟢 **Online**: All changes sync automatically
  - 🔴 **Offline**: Working in offline mode, changes queued for sync
  - 🔄 **Syncing**: Currently syncing pending changes
  - ⚠️ **Sync Failed**: Some items failed to sync (with retry button)

### ✅ Sync Engine

- **Automatic Processing**: Syncs pending changes when connection is restored
- **Retry Logic**: Exponential backoff for failed syncs (max 5 attempts)
- **Idempotency**: Uses UUID-based idempotency keys to prevent duplicate transactions
- **Queue-based**: FIFO processing of pending changes
- **Non-blocking**: Sync runs in background without blocking UI

## Architecture

### IndexedDB Storage

All offline data is stored in IndexedDB using the `idb` library:

- **orders**: Local orders (synced and unsynced)
- **returns**: Local returns
- **inventory_snapshots**: Product stock snapshots
- **outbox**: Queue of pending mutations to sync
- **meta**: Sync metadata (timestamps, etc.)

### Outbox Queue

Every mutation (create order, return, expense, etc.) when offline:

1. Saves data to IndexedDB
2. Adds entry to outbox queue with:
   - `id`: Unique identifier
   - `type`: Mutation type (CREATE_ORDER, CREATE_RETURN, etc.)
   - `payload`: Mutation data
   - `idempotencyKey`: UUID for idempotency
   - `entityId`: Local entity ID
   - `status`: pending | processing | failed | done
   - `attempts`: Retry count

### Sync Process

When online, the sync engine:

1. Fetches all pending outbox items
2. Processes each item in FIFO order
3. Calls appropriate API endpoint with idempotency key
4. On success: Marks item as done and deletes from queue
5. On failure: Increments attempts, applies backoff, retries up to 5 times

## Usage

### For Users

1. **Work Normally**: The system automatically detects online/offline status
2. **Offline Indicator**: Check the network badge in the header
3. **Manual Sync**: If sync fails, click "Retry" button in the badge
4. **Settings**: Go to Settings → Offline & Sync for:
   - View sync status
   - Manual sync trigger
   - Clear local cache (if needed)

### For Developers

#### Adding Offline Support to New Mutations

1. **Check Online Status**:
   ```typescript
   const isOnline = navigator.onLine;
   ```

2. **If Offline, Save to IndexedDB and Add to Outbox**:
   ```typescript
   if (!isOnline) {
     // Save to IndexedDB
     await saveLocalOrder(orderId, order, items, payments);
     
     // Add to outbox
     const idempotencyKey = generateUUID();
     await addToOutbox({
       type: 'CREATE_ORDER',
       payload: { order, items, payments },
       idempotencyKey,
       entityId: orderId,
     });
     
     // Return optimistic response
     return { order_id: orderId, order_number: orderNumber };
   }
   ```

3. **If Online, Call API Normally**:
   ```typescript
   // Existing API call
   const result = await api.createOrder(...);
   return result;
   ```

4. **Update Sync Engine**:
   Add handler in `src/offline/syncEngine.ts`:
   ```typescript
   case 'YOUR_MUTATION_TYPE': {
     const payload = item.payload as YourPayloadType;
     const result = await yourApiFunction(payload);
     success = true;
     serverId = result.id;
     break;
   }
   ```

## Files Structure

```
src/
├── offline/
│   ├── db.ts              # IndexedDB operations
│   ├── types.ts           # Offline types and interfaces
│   └── syncEngine.ts      # Sync engine implementation
├── hooks/
│   ├── useNetworkStatus.ts    # Network status hook
│   └── useSyncEngine.ts       # Sync engine hook
└── components/
    └── common/
        └── NetworkBadge.tsx   # Network status badge component
```

## Testing

### Manual Testing Checklist

- [ ] **Create Order Offline**
  1. Disconnect internet
  2. Create a new order in POS
  3. Verify order appears in orders list
  4. Refresh page - order should still be there
  5. Reconnect internet
  6. Verify order syncs automatically

- [ ] **Sync Status**
  1. Check network badge shows correct status
  2. Verify pending count updates
  3. Test manual retry button

- [ ] **Settings Panel**
  1. Go to Settings → Offline & Sync
  2. Verify status information
  3. Test manual sync button
  4. Test clear cache (with caution)

- [ ] **Error Handling**
  1. Simulate API failure
  2. Verify retry logic works
  3. Verify failed items show in UI

## Configuration

### Sync Intervals

- **Auto-sync**: Every 10 seconds when online
- **Retry Backoff**: 1s, 2s, 4s, 8s, 16s (exponential)
- **Max Retries**: 5 attempts per item

### Storage Limits

- IndexedDB has no hard limit (browser-dependent)
- Outbox items are deleted after successful sync
- Old synced orders can be cleaned up periodically (future enhancement)

## Troubleshooting

### Sync Not Working

1. Check network status badge
2. Go to Settings → Offline & Sync
3. Click "Retry Sync" manually
4. Check browser console for errors

### Data Not Persisting

1. Check browser IndexedDB support
2. Check browser storage permissions
3. Clear cache and retry

### Duplicate Orders

- Should not happen due to idempotency keys
- If it does, check server-side idempotency handling

## Future Enhancements

- [ ] Conflict resolution UI
- [ ] Sync progress indicator
- [ ] Batch sync optimization
- [ ] Offline data cleanup/archival
- [ ] Sync history/audit log
- [ ] Selective sync (sync only specific types)

## Notes

- All currency formatting remains consistent (uses `formatMoneyUZS`)
- No breaking changes to existing flows
- Offline mode is always enabled (cannot be disabled)
- Sync is automatic and non-blocking

