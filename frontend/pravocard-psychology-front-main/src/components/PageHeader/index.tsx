// src/PageHeader.tsx
import React from "react";

interface PageHeaderProps {
  sectionTitle: string;
  subtitle: string;
}

export const PageHeader: React.FC<PageHeaderProps> = ({
  sectionTitle,
  subtitle,
}) => {
  return (
    <header className="section-header">
      <h1 className="section-title">{sectionTitle}</h1>
      <div className="section-subtitle">{subtitle}</div>
    </header>
  );
};