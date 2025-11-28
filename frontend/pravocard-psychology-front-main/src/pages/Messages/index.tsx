import React, { useState } from "react";
import { MessageForm } from "../../components/MessageForm";

export const Messages: React.FC = () => {
  const [firstMessage, setFirstMessage] = useState(
    "Привет!\n\nЧтобы начать, нажмите кнопку «Войти с ПравокардID»."
  );
  const [secondMessage, setSecondMessage] = useState(
    "Привет! Я - Luni - ИИ ЗОЖ. Помогу тебе с планами тренировок и питания. А ещё - помогу посчитать калории по фото!"
  );

  const handleSaveFirst = () => {
    console.log("Первое сообщение:", firstMessage);
  };

  const handleSaveSecond = () => {
    console.log("Второе сообщение:", secondMessage);
  };

  return (
    <>
      <MessageForm
        label="Первое сообщение"
        value={firstMessage}
        onChange={setFirstMessage}
        onSave={handleSaveFirst}
      />

      <MessageForm
        label="Второе сообщение"
        value={secondMessage}
        onChange={setSecondMessage}
        onSave={handleSaveSecond}
      />
    </>
  );
};

