import React, { useState } from "react";
import { MessageForm } from "../../components/MessageForm";

export const Diagnostic: React.FC = () => {
  const [text, setText] = useState("");
  const handleSaveFirst = () => {
    console.log("Первое сообщение:", text);
  };
  return (
    <>
      <h1>Диагностика</h1>
      <MessageForm
        label="Контекст"
        value={text}
        onChange={setText}
        onSave={handleSaveFirst}
      />
    </>
  );
};
