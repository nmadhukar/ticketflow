# S3 Usage Monitoring Dashboard Implementation

## Overview

Add S3 storage usage monitoring to the admin dashboard, positioned above the Bedrock cost monitoring section. The component will display storage statistics calculated from the `task_attachments` table.

## Backend Changes

### 1. Add Storage Method (`server/storage/index.ts`)

- Add `getS3UsageStats()` method to `IStorage` interface and `DatabaseStorage` class
- Query `task_attachments` table to calculate:
  - Total storage used (sum of `fileSize` in bytes, convert to GB/MB)
  - Total file count
  - Daily usage trends (group by date from `createdAt`)
  - Monthly usage trends (group by month)
  - Recent uploads (last 10-20 files with metadata)
- Return structured data similar to Bedrock cost statistics

### 2. Add API Endpoint (`server/routes/index.ts`)

- Create `GET /api/admin/s3-usage` endpoint
- Admin-only access (check `user.role === "admin"`)
- Call `storage.getS3UsageStats()`
- Return JSON with:
  ```typescript
  {
    totalStorage: number, // in bytes
    totalFiles: number,
    dailyUsage: Array<{ date: string, storage: number, files: number }>,
    monthlyUsage: Array<{ month: string, storage: number, files: number }>,
    recentUploads: Array<{ fileName: string, fileSize: number, uploadedAt: string, taskId: number }>,
    warning?: string // "Some files may have been deleted from S3"
  }
  ```

### 3. Update Storage Interface (`server/storage/storage.interface.ts`)

- Add method signature:
  ```typescript
  getS3UsageStats(): Promise<{
    totalStorage: number;
    totalFiles: number;
    dailyUsage: Array<{ date: string; storage: number; files: number }>;
    monthlyUsage: Array<{ month: string; storage: number; files: number }>;
    recentUploads: Array<{ fileName: string; fileSize: number; uploadedAt: string; taskId: number }>;
  }>;
  ```

## Frontend Changes

### 4. Create S3 Usage Component (`client/src/components/s3-usage-monitoring.tsx`)

- Similar structure to `BedrockCostMonitoring` component
- Display:
  - **Summary Cards**: Total storage (GB/MB), total files, storage this month
  - **Trend Charts**: Daily and monthly storage usage (line/bar charts using recharts)
  - **Recent Uploads Table**: Last 10-20 uploads with file name, size, date, task link
  - **Warning Alert**: "Note: Some files may have been deleted from S3 but are still counted in statistics"
- Use `useQuery` with `refetchInterval: 30000` (30 seconds)
- Loading states and error handling
- Format file sizes (bytes to KB/MB/GB)
- Format dates using `date-fns`

### 5. Update Dashboard (`client/src/pages/dashboard.tsx`)

- Import `S3UsageMonitoring` component
- Add component above `BedrockCostMonitoring` in the grid
- Keep same 2-column span (`col-span-2`)
- Move BedrockCostMonitoring below S3 usage section
- Only show for admin users (`user?.role === "admin"`)

### 6. Add Translations (Optional)

- Add S3 usage labels to translation files if needed
- Or use English labels directly in component

## Implementation Details

### Storage Calculation

- Use SQL aggregation: `SUM(file_size)`, `COUNT(*)`
- Group by date: `DATE(created_at)` for daily trends
- Group by month: `DATE_TRUNC('month', created_at)` for monthly trends
- Order recent uploads by `created_at DESC LIMIT 20`

### File Size Formatting

- Convert bytes to human-readable format:
  - < 1024: bytes
  - < 1024 KB: KB
  - < 1024 MB: MB
  - > = 1024 MB: GB

### Chart Data

- Use recharts library (already used in manager-stats.tsx)
- Line chart for daily trends
- Bar chart for monthly trends
- Responsive container

## Files to Modify

1. `server/storage/storage.interface.ts` - Add method signature
2. `server/storage/index.ts` - Implement `getS3UsageStats()`
3. `server/routes/index.ts` - Add `/api/admin/s3-usage` endpoint
4. `client/src/components/s3-usage-monitoring.tsx` - Create new component
5. `client/src/pages/dashboard.tsx` - Add component above Bedrock

## Notes

- Statistics are calculated from database only (not real-time S3 queries)
- Warning message will inform admins that deleted files may still be counted
- Component will auto-refresh every 30 seconds
- Only visible to admin users
