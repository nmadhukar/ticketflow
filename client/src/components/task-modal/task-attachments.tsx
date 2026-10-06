import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/hooks/useAuth";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Paperclip, Upload, X } from "lucide-react";
import { useRef, useState, useEffect } from "react";
import { useTranslation } from "react-i18next";

// Default limits (matching server defaults)
const DEFAULT_MAX_FILE_SIZE_MB = 50;
const DEFAULT_MAX_FILES_PER_REQUEST = 10;

// Format file size helper
const formatFileSize = (bytes: number): string => {
  if (bytes === 0) return "0 Bytes";
  if (bytes < 1024) return `${bytes} Bytes`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const TaskAttachments = ({
  task,
  onFilesChange,
}: {
  task: any;
  onFilesChange?: (files: File[]) => void;
}) => {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { t } = useTranslation();
  const { user } = useAuth() as any;
  const userRole = user?.role as string | undefined;

  // File upload limits (can be fetched from API or use defaults)
  const [maxFileSizeMB, setMaxFileSizeMB] = useState(DEFAULT_MAX_FILE_SIZE_MB);
  // MAX_FILES_PER_REQUEST is server-side only, use constant default
  const maxFilesPerRequest = DEFAULT_MAX_FILES_PER_REQUEST;
  const [isDragging, setIsDragging] = useState(false);

  // File attachment mutations
  const addAttachmentMutation = useMutation({
    mutationFn: async (formData: FormData) => {
      const res = await apiRequest(
        "POST",
        `/api/tasks/${task?.id}/attachments`,
        formData
      );
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/tasks/${task?.id}/attachments`] });
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.fileAttached"),
      });
    },
    onError: (error: any) => {
      if (isUnauthorizedError(error)) {
        toast({
          title: t("messages.unauthorized"),
          description: t("messages.loggedOut"),
          variant: "destructive",
        });
        setTimeout(() => {
          window.location.href = "/login";
        }, 500);
        return;
      }

      // Check for S3 configuration error
      let errorMessage =
        error?.message ||
        t("tickets:modal.toasts.errorAttach", {
          defaultValue: "Failed to attach file",
        });

      // Check if error data contains S3 configuration error
      if (error?.data?.error === "S3_CONFIGURATION_REQUIRED") {
        errorMessage = error.data.message;
      } else if (
        error?.message?.includes("S3_CONFIGURATION_REQUIRED") ||
        error?.message?.includes("File storage is not available")
      ) {
        errorMessage =
          userRole === "admin"
            ? "File storage is not configured. Please configure AWS S3 credentials in environment variables."
            : "File storage is not available. Please contact your administrator to configure file storage.";
      }

      toast({
        title: t("messages.error"),
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const fileInputRef = useRef<HTMLInputElement>(null);
  const dropZoneRef = useRef<HTMLDivElement>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Fetch upload limits from company settings (optional - falls back to defaults)
  useEffect(() => {
    const fetchLimits = async () => {
      try {
        const res = await apiRequest(
          "GET",
          "/api/company-settings/preferences"
        );
        const settings = await res.json();
        if (settings?.maxFileUploadSize) {
          setMaxFileSizeMB(settings.maxFileUploadSize);
        }
        // Note: MAX_FILES_PER_REQUEST is server-side only, use default
      } catch {
        // Use defaults if fetch fails
        console.warn("Could not fetch upload limits, using defaults");
      }
    };
    if (!task?.id) {
      fetchLimits();
    }
  }, [task?.id]);

  // Notify parent when files change
  useEffect(() => {
    if (onFilesChange) {
      onFilesChange(selectedFiles);
    }
  }, [selectedFiles, onFilesChange]);

  // Clear selected files when task is created (task.id changes from undefined to a number)
  useEffect(() => {
    if (task?.id) {
      setSelectedFiles([]);
    }
  }, [task?.id]);

  // Validate files before adding
  const validateFiles = (
    files: File[]
  ): { valid: File[]; errors: string[] } => {
    const valid: File[] = [];
    const errors: string[] = [];
    const maxSizeBytes = maxFileSizeMB * 1024 * 1024;
    const currentFileCount = selectedFiles.length;

    for (const file of files) {
      // Check file size
      if (file.size > maxSizeBytes) {
        errors.push(
          `${file.name} exceeds the maximum file size of ${maxFileSizeMB}MB`
        );
        continue;
      }

      // Check total file count
      if (currentFileCount + valid.length >= maxFilesPerRequest) {
        errors.push(
          `Maximum ${maxFilesPerRequest} files allowed. Please remove some files first.`
        );
        break;
      }

      valid.push(file);
    }

    return { valid, errors };
  };

  const processFiles = (files: File[]) => {
    if (files.length === 0 || addAttachmentMutation.isPending) return;

    if (task?.id) {
      // Existing task: upload immediately (single file)
      const file = files[0];
      const maxSizeBytes = maxFileSizeMB * 1024 * 1024;

      if (file.size > maxSizeBytes) {
        toast({
          title: t("messages.error"),
          description: `File exceeds the maximum size of ${maxFileSizeMB}MB`,
          variant: "destructive",
        });
        return;
      }

      const formData = new FormData();
      formData.append("file", file);
      addAttachmentMutation.mutate(formData);
    } else {
      // New task: validate and store files
      const { valid, errors } = validateFiles(files);

      if (errors.length > 0) {
        errors.forEach((error) => {
          toast({
            title: t("messages.error"),
            description: error,
            variant: "destructive",
          });
        });
      }

      if (valid.length > 0) {
        setSelectedFiles((prev) => [...prev, ...valid]);
      }
    }

    // Reset the input
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files || []);
    processFiles(files);
  };

  // Drag and drop handlers
  const handleDragEnter = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    if (!task?.id) {
      setIsDragging(true);
    }
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragging(false);

    if (task?.id) {
      // For existing tasks, only allow single file
      const files = Array.from(e.dataTransfer.files);
      if (files.length > 0) {
        processFiles([files[0]]);
      }
    } else {
      // For new tasks, allow multiple files
      const files = Array.from(e.dataTransfer.files);
      processFiles(files);
    }
  };

  const handleRemoveFile = (index: number) => {
    setSelectedFiles((prev) => prev.filter((_, i) => i !== index));
  };

  const handleClick = () => {
    if (!addAttachmentMutation.isPending && fileInputRef.current) {
      fileInputRef.current.click();
    }
  };

  return (
    <Card>
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Upload className="h-4 w-4" />
          {t("tickets:modal.sections.attachments")}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <div
          ref={dropZoneRef}
          className={`border-2 border-dashed rounded-lg text-center transition-colors ${
            isDragging
              ? "border-primary bg-primary/5"
              : "border-border hover:border-primary"
          }`}
          onDragEnter={handleDragEnter}
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
        >
          <input
            ref={fileInputRef}
            type="file"
            id="file-upload"
            aria-label="Ticket attachments"
            className="hidden"
            onChange={handleFileSelect}
            disabled={addAttachmentMutation.isPending}
            multiple={!task?.id} // Allow multiple files for new tasks
          />
          <button
            type="button"
            aria-label="Choose files"
            disabled={addAttachmentMutation.isPending}
            onClick={handleClick}
            className="w-full rounded-md p-6 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:opacity-50"
          >
            <Paperclip className="h-8 w-8 mx-auto mb-2 text-muted-foreground" />
            <span className="block text-sm text-foreground">
              {isDragging
                ? "Drop files here"
                : t("tickets:modal.placeholders.uploadCta")}
            </span>
            <span className="block text-xs text-muted-foreground mt-1">
              {t("tickets:modal.placeholders.uploadHelp")}
              {!task?.id && (
                <span className="block mt-1">
                  Max {maxFilesPerRequest} files, {maxFileSizeMB}MB per file
                </span>
              )}
            </span>
          </button>
        </div>

        {/* Show selected files for new tasks */}
        {!task?.id && selectedFiles.length > 0 && (
          <div className="mt-4 space-y-2">
            <p className="text-xs font-medium text-foreground">
              Selected Files ({selectedFiles.length}):
            </p>
            {selectedFiles.map((file, index) => (
              <div
                key={index}
                className="flex items-center justify-between p-2 bg-muted/40 rounded border border-border"
              >
                <div className="flex items-center gap-2 flex-1 min-w-0">
                  <Paperclip className="h-4 w-4 text-muted-foreground flex-shrink-0" />
                  <span className="text-sm text-foreground truncate">
                    {file.name}
                  </span>
                  <span className="text-xs text-muted-foreground flex-shrink-0">
                    ({formatFileSize(file.size)})
                  </span>
                </div>
                <button
                  type="button"
                  onClick={() => handleRemoveFile(index)}
                  className="ml-2 flex h-10 w-10 shrink-0 items-center justify-center hover:bg-muted rounded-md transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  aria-label={`Remove ${file.name}`}
                >
                  <X className="h-4 w-4 text-muted-foreground" />
                </button>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
};

export default TaskAttachments;
