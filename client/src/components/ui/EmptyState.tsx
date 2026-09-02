import { ReactNode } from "react";
import { CornerDownLeft } from "lucide-react";

export function EmptyState({ title, description }: { title: string; description?: string }) {
  return (
    <div className="empty-state">
      <CornerDownLeft className="w-12 h-12" />
      <h3 className="title">{title}</h3>
      {description && <p className="subtitle">{description}</p>}
    </div>
  );
}
