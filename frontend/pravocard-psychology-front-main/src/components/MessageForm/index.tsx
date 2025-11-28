// src/MessageForm.tsx
import React from "react";

interface MessageFormProps {
  label: string;
  value: string;
  onChange: (value: string) => void;
  onSave: () => void;
}

export const MessageForm: React.FC<MessageFormProps> = ({
  label,
  value,
  onChange,
  onSave,
}) => {
  return (
    <div className="message-block">
      <div className="message-label">{label}</div>
      <textarea
        className="message-textarea"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div className="message-actions">
        <button className="save-button" onClick={onSave}>
          Сохранить
        </button>
      </div>
    </div>
  );
};