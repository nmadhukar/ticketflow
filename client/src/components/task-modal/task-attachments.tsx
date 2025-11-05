import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { isUnauthorizedError } from "@/lib/authUtils";
import { apiRequest } from "@/lib/queryClient";
import { useMutation } from "@tanstack/react-query";
import { Paperclip, Upload } from "lucide-react";
import { useTranslation } from "react-i18next";

const TaskAttachments = ({ task }: { task: any }) => {
  const { toast } = useToast();
  const { t } = useTranslation();

  // File attachment mutations
  const addAttachmentMutation = useMutation({
    mutationFn: async (attachmentData: any) => {
      return await apiRequest(
        "POST",
        `/api/tasks/${task?.id}/attachments`,
        attachmentData
      );
    },
    onSuccess: () => {
      toast({
        title: t("messages.success"),
        description: t("tickets:modal.toasts.fileAttached"),
      });
    },
    onError: (error) => {
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
      toast({
        title: t("messages.error"),
        description: t("tickets:modal.toasts.errorAttach", {
          defaultValue: "Failed to attach file",
        }),
        variant: "destructive",
      });
    },
  });

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !task?.id) return;

    // In a real app, you would upload the file to a storage service
    // For now, we'll simulate with a fake URL
    const fakeUrl = `https://storage.example.com/${Date.now()}_${file.name}`;

    await addAttachmentMutation.mutateAsync({
      fileName: file.name,
      fileSize: file.size,
      fileType: file.type,
      fileUrl: fakeUrl,
    });

    // Reset the input
    e.target.value = "";
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
        <div className="border-2 border-dashed border-slate-300 rounded-lg p-6 text-center hover:border-blue-500 transition-colors">
          <input
            type="file"
            id="file-upload"
            className="hidden"
            onChange={handleFileUpload}
            disabled={addAttachmentMutation.isPending || !task?.id}
          />
          <label htmlFor="file-upload" className="cursor-pointer">
            <Paperclip className="h-8 w-8 mx-auto mb-2 text-slate-400" />
            <p className="text-sm text-slate-600">
              {t("tickets:modal.placeholders.uploadCta")}
            </p>
            <p className="text-xs text-slate-500 mt-1">
              {t("tickets:modal.placeholders.uploadHelp")}
            </p>
          </label>
        </div>
        {!task?.id && (
          <p className="text-xs text-slate-500 mt-2">
            {t("tickets:modal.placeholders.uploadAfterCreate", {
              defaultValue: "You can upload files after creating the ticket.",
            })}
          </p>
        )}
      </CardContent>
    </Card>
  );
};

export default TaskAttachments;
