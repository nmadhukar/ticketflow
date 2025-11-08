### Architecture

**Single Endpoint**:

- `POST /api/tasks`
- Content-Type: `multipart/form-data`
- Fields: `title`, `description`, `category`, etc. (as form fields)
- Files: `files[]` (array of files via multer)
- Server handles everything in one request

## Implementation Details

### 1. Modified Task Creation: `POST /api/tasks`

**Request**:

- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - Task fields: `title`, `description`, `category`, `priority`, `status`, `assigneeId`, `assigneeType`, `assigneeTeamId`, `departmentId`, `teamId`, `dueDate`, etc. (as form fields)
  - Files: `files[]` (array of files via multer)

**Response** (201 Created):n
{
"id": 123,
"ticketNumber": "TKT-2024-0001",
"title": "My Task",
"description": "...",
"attachments": [
{
"id": 1,
"fileName": "document.pdf",
"fileSize": 245632,
"fileType": "application/pdf",
"fileUrl": "attachments/pending/user123/1705312200000-document.pdf"
}
],
"createdAt": "2024-01-15T10:30:00Z"
}**S3 Key Structure**:

- Path: `attachments/pending/{userId}/{timestamp}-{sanitizedFilename}`
- Example: `attachments/pending/user-abc-123/1705312200000-screenshot.png`
- **Note**: Files kept in `pending/` folder (no move operation needed for simplicity)

**Processing Flow**:

1. **Validate S3 Configuration** (if files provided)

   - Check if S3 is configured
   - Return role-based error messages if not configured

2. **Upload Files to S3** (if files provided)

   - For each file:
     - Validate file size (use company settings)
     - Validate file type (optional)
     - Sanitize filename
     - Upload to S3: `attachments/pending/{userId}/{timestamp}-{sanitizedFilename}`
   - If any file upload fails, cleanup already uploaded files and return error

3. **Create Task**

   - Parse task data from form fields
   - Validate task data
   - Create task in database

4. **Create Attachment Records** (if files provided)

   - For each uploaded file:
     - Create `task_attachments` record
     - Link to created task ID
     - Set userId to task creator
   - If attachment record creation fails, log error but continue (task is created)

5. **Return Task**
   - Return created task with attachment information
   - Include warning if some attachments failed to link

**Error Handling**:

- **S3 Configuration Error**: Return 503 with role-based messages
- **File Upload Error**: Cleanup uploaded files, return 500
- **File Validation Error**: Return 400 with specific error
- **Task Creation Error**: Files already uploaded (in pending), return 500
- **Attachment Linking Error**: Log error, return task with warning

### 2. Keep Existing Endpoint: `POST /api/tasks/:id/attachments`

**Purpose**: Add attachments to existing tasks (unchanged)

**Request**:

- Method: `POST` (keep as POST for existing tasks)
- Content-Type: `multipart/form-data`
- Body: `file` (file to upload)

**Response** (201 Created):
{
"id": 1,
"taskId": 123,
"fileName": "document.pdf",
"fileSize": 245632,
"fileType": "application/pdf",
"fileUrl": "attachments/123/1705312200000-document.pdf",
"createdAt": "2024-01-15T10:30:00Z"
}**S3 Key Structure**:

- Path: `attachments/{taskId}/{timestamp}-{sanitizedFilename}`
- Example: `attachments/123/1705312200000-screenshot.png`

**Behavior**:

- Upload to S3
- Create database record immediately
- Return full attachment record

## Database Design Decision

### ✅ Keep Separate `task_attachments` Table

**Why:**

- ✅ Supports multiple attachments per task
- ✅ Stores metadata per file (uploader, timestamp, size, type)
- ✅ Easy to query, filter, and delete individual attachments
- ✅ Scalable and follows database normalization principles
- ✅ Can track who uploaded what and when

## Frontend Changes

### TaskModal Component (`client/src/components/task-modal/index.tsx`)

**Modify `createTaskMutation`**:

1. **Collect Files**: Get selected files from file input
2. **Create FormData**:
   - Append all task fields as form fields
   - Append all files as `files[]` array
3. **Single Request**: Send `POST /api/tasks` with FormData
4. **Handle Response**:
   - Show success message
   - Handle errors appropriately
   - Show warning if some attachments failed

**Code Example**:escript
const createTaskMutation = useMutation({
mutationFn: async (taskData: any) => {
const formData = new FormData();

    // Append task fields
    formData.append("title", taskData.title);
    formData.append("description", taskData.description || "");
    formData.append("category", taskData.category);
    formData.append("priority", taskData.priority);
    formData.append("status", taskData.status);
    if (taskData.assigneeId) formData.append("assigneeId", taskData.assigneeId);
    if (taskData.assigneeType) formData.append("assigneeType", taskData.assigneeType);
    if (taskData.assigneeTeamId) formData.append("assigneeTeamId", taskData.assigneeTeamId);
    if (taskData.departmentId) formData.append("departmentId", taskData.departmentId);
    if (taskData.teamId) formData.append("teamId", taskData.teamId);
    if (taskData.dueDate) formData.append("dueDate", taskData.dueDate);

    // Append files
    if (selectedFiles && selectedFiles.length > 0) {
      selectedFiles.forEach((file) => {
        formData.append("files", file);
      });
    }

    return await apiRequest("POST", "/api/tasks", formData);

},
onSuccess: (response) => {
const task = await response.json();
// Handle success
if (task.warning) {
// Show warning about attachment failures
}
},
onError: (error) => {
// Handle error
}
});### TaskAttachments Component (`client/src/components/task-modal/task-attachments.tsx`)

**For New Tasks**:

- Allow file selection (no task ID required)
- Store selected files in component state
- Pass files to parent component (TaskModal) when creating task
- Show selected files list with remove option

**For Existing Tasks**:

- Keep existing behavior (upload via `POST /api/tasks/:id/attachments`)

**Code Example**:pescript
const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
const files = Array.from(e.target.files || []);
setSelectedFiles(prev => [...prev, ...files]);
};

const handleRemoveFile = (index: number) => {
setSelectedFiles(prev => prev.filter((\_, i) => i !== index));
};

// Pass selectedFiles to parent via props or context## Backend Changes

### 1. `server/routes/index.ts`

**Modify `POST /api/tasks` endpoint**:

- Add multer middleware: `upload.array("files", 10)` (max 10 files)
- Handle multipart/form-data
- Extract task fields from `req.body`
- Extract files from `req.files`
- Implement processing flow as described above

**Key Implementation Points**:
ypescript
app.post("/api/tasks", isAuthenticated, upload.array("files", 10), async (req: any, res) => {
try {
const userId = getUserId(req);
const files = req.files as Express.Multer.File[];
const user = await storage.getUser(userId);

    // 1. Validate S3 configuration if files provided
    if (files && files.length > 0) {
      const s3Config = s3Service.isConfigured();
      if (!s3Config.isConfigured) {
        if (user?.role === "admin") {
          return res.status(503).json({
            message: "File storage is not configured",
            error: "S3_CONFIGURATION_REQUIRED",
            details: `Missing configuration: ${s3Config.missing.join(", ")}`
          });
        } else {
          return res.status(503).json({
            message: "File storage is not available. Please contact your administrator.",
            error: "S3_CONFIGURATION_REQUIRED"
          });
        }
      }

      // Validate file sizes
      const companySettings = await storage.getCompanySettings();
      const maxSizeMB = companySettings?.maxFileUploadSize || 10;
      const maxSizeBytes = maxSizeMB * 1024 * 1024;

      for (const file of files) {
        if (file.size > maxSizeBytes) {
          return res.status(400).json({
            message: `File ${file.originalname} exceeds ${maxSizeMB}MB limit`
          });
        }
      }
    }

    // 2. Upload files to S3 (if provided)
    const uploadedFiles = [];
    if (files && files.length > 0) {
      try {
        for (const file of files) {
          const timestamp = Date.now();
          const sanitizedFileName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, "_");
          const s3Key = `attachments/pending/${userId}/${timestamp}-${sanitizedFileName}`;

          await s3Service.uploadFile(s3Key, file.buffer, file.mimetype);
          uploadedFiles.push({
            s3Key,
            fileName: file.originalname,
            fileSize: file.size,
            fileType: file.mimetype
          });
        }
      } catch (error) {
        // Cleanup uploaded files
        for (const file of uploadedFiles) {
          await s3Service.deleteFile(file.s3Key).catch(() => {});
        }
        return res.status(500).json({ message: "File upload failed", error: error.message });
      }
    }

    // 3. Create task (existing logic)
    const taskData = insertTaskSchema.parse({
      ...req.body,
      createdBy: userId,
    });
    const task = await storage.createTask(taskData);

    // 4. Create attachment records (if files provided)
    const attachmentErrors = [];
    if (uploadedFiles.length > 0) {
      for (const file of uploadedFiles) {
        try {
          await storage.addTaskAttachment({
            taskId: task.id,
            userId,
            fileName: file.fileName,
            fileSize: file.fileSize,
            fileType: file.fileType,
            fileUrl: file.s3Key
          });
        } catch (error) {
          attachmentErrors.push(file.fileName);
          console.error(`Failed to create attachment record for ${file.fileName}:`, error);
        }
      }
    }

    // 5. Return task with warning if some attachments failed
    if (attachmentErrors.length > 0) {
      return res.status(201).json({
        ...task,
        warning: `Some attachments failed to link: ${attachmentErrors.join(", ")}`
      });
    }

    res.status(201).json(task);

} catch (error) {
// Handle errors
}
});### 2. `server/index.ts`

**Increase Request Size Limits**:
script
// Increase JSON body parser limit for file uploads
app.use(express.json({ limit: "50mb" }));
app.use(express.urlencoded({ extended: true, limit: "50mb" }));### 3. `server/routes/index.ts` (Multer Configuration)

**Update Multer Limits**:
script
const upload = multer({
storage: multer.memoryStorage(),
limits: {
fileSize: 50 _ 1024 _ 1024, // 50MB per file
files: 10 // Max 10 files
}
});### 4. `server/services/s3Service.ts`

- No changes needed (already supports any S3 key structure)

### 5. `server/storage/index.ts`

- No changes needed (existing `addTaskAttachment` method works)

## API Endpoints Summary

| Method   | Endpoint                        | Purpose                | When to Use        |
| -------- | ------------------------------- | ---------------------- | ------------------ |
| `POST`   | `/api/tasks`                    | Create task with files | New task flow      |
| `POST`   | `/api/tasks/:id/attachments`    | Add to existing task   | Edit existing task |
| `GET`    | `/api/tasks/:id/attachments`    | List attachments       | View task          |
| `GET`    | `/api/attachments/:id/download` | Download attachment    | Download file      |
| `DELETE` | `/api/attachments/:id`          | Delete attachment      | Remove file        |

## Benefits

1. **Simpler Frontend**: No need to manage pending attachments state
2. **Atomic Operation**: Task and attachments created together (or both fail)
3. **Less Network Overhead**: One round trip instead of multiple
4. **No Orphaned Files**: If task creation fails, files aren't created
5. **Simpler State Management**: No need to track pending attachments
6. **Single Request**: Everything in one API call

## Considerations

### Security

- Validate file types and sizes
- Sanitize file names
- Check user permissions
- Rate limiting on upload endpoint

### Performance

- **Request Size Limits**: Increased to 50MB (configurable)
- **Server Timeout**: May need to increase for large files
- **Memory Usage**: All files held in memory during processing
- **File Count Limit**: Max 10 files per request (configurable)

### Error Handling

- **File Upload Failure**: Cleanup uploaded files, return error
- **Task Creation Failure**: Files already in S3 (in pending), need cleanup
- **Attachment Linking Failure**: Task exists, files in S3, log error and continue

### Edge Cases

- **No Files**: Task creation works normally (files optional)
- **Large Files**: May cause timeout, consider chunked uploads (future)
- **Multiple Large Files**: Monitor server memory usage
- **Network Interruption**: Entire request fails, user must retry

## Testing Scenarios

1. ✅ Create task with single file → Verify task and attachment created
2. ✅ Create task with multiple files → Verify all attachments linked
3. ✅ Create task without files → Verify task created normally
4. ✅ Create task with invalid file size → Verify error returned
5. ✅ Create task with S3 not configured → Verify role-based error message
6. ✅ Create task, file upload succeeds but task creation fails → Verify files cleaned up
7. ✅ Create task, task creation succeeds but attachment linking fails → Verify task exists, warning returned
8. ✅ Add attachment to existing task (POST endpoint) → Verify works as before
9. ✅ Large file upload → Verify timeout handling
10. ✅ Multiple large files → Verify memory handling

## Migration Notes

- **No Database Migration Required**: Using existing `task_attachments` table
- **Backward Compatible**: Existing `POST /api/tasks/:id/attachments` unchanged
- **S3 Structure**: New `pending/` folder for new task attachments
- **Request Size**: Need to increase Express/multer limits

## Configuration Changes

### Environment Variables

- No new environment variables needed
- Existing S3 configuration used

### Server Configuration

- Increase `express.json` limit to 50MB
- Increase `express.urlencoded` limit to 50MB
- Increase multer `fileSize` limit to 50MB
- Set multer `files` limit to 10

## Future Enhancements

1. **Chunked Uploads**: For very large files (>100MB)
2. **Progress Tracking**: Real-time upload progress (would require two-step approach)
3. **File Preview**: Preview images/PDFs before upload
4. **Drag & Drop**: Enhanced file selection UX
5. **File Versioning**: Track file updates/replacements
6. **S3 Lifecycle Policy**: Auto-cleanup orphaned files in pending folder

## Success Criteria

- ✅ Users can upload files when creating a task
- ✅ Files are stored in S3 immediately
- ✅ Task and attachments are created in single request
- ✅ Attachments are properly linked to tasks
- ✅ Error handling is comprehensive
- ✅ Both new and existing task flows work correctly
- ✅ Large files are handled appropriately
