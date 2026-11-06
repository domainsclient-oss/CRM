"use client";

import { useRouter } from "next/navigation";
import { BrandingEditor, type BrandingValues } from "@crm/ui/components/branding-editor";
import type { BrandAssetKind } from "@crm/shared/branding/schemas";
import {
  removeWorkspaceAssetAction,
  updateWorkspaceBrandingAction,
  uploadWorkspaceAssetAction,
} from "./actions";

export function WorkspaceBranding(props: {
  own: BrandingValues;
  inherited: { appName: string; primaryColor: string; accentColor: string };
  assets: Record<BrandAssetKind, string | null>;
  readOnly: boolean;
}) {
  const router = useRouter();
  return (
    <BrandingEditor
      {...props}
      onSave={(values) => updateWorkspaceBrandingAction(values)}
      onUpload={(kind, file) => uploadWorkspaceAssetAction({ kind, file })}
      onRemove={(kind) => removeWorkspaceAssetAction({ kind })}
      onChanged={() => router.refresh()}
    />
  );
}
