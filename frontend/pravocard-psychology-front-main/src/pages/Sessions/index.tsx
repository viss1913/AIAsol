import React, { useState } from "react";

export const Sessions: React.FC = () => {
  const [firstTitle, setFirstTitle] = useState("");
  const [firstContent, setFirstContent] = useState("");
  const [secondTitle, setSecondTitle] = useState("");
  const [secondContent, setSecondContent] = useState("");

  const handleSaveFirst = () => {
    console.log("Первая форма:", { title: firstTitle, content: firstContent });
  };

  const handleSaveSecond = () => {
    console.log("Вторая форма:", { title: secondTitle, content: secondContent });
  };

  return (
    <>
      <div style={{ marginBottom: "24px" }}>
        <input
          type="text"
          placeholder="Заголовок первой формы"
          value={firstTitle}
          onChange={(e) => setFirstTitle(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            marginBottom: "12px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontFamily: "inherit",
            fontSize: "14px",
          }}
        />
        <textarea
          placeholder="Содержимое первой формы"
          value={firstContent}
          onChange={(e) => setFirstContent(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "12px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontFamily: "inherit",
            fontSize: "14px",
            minHeight: "120px",
            resize: "vertical",
          }}
        />
        <button
          onClick={handleSaveFirst}
          style={{
            padding: "8px 16px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Сохранить
        </button>
      </div>

      <div>
        <input
          type="text"
          placeholder="Заголовок второй формы"
          value={secondTitle}
          onChange={(e) => setSecondTitle(e.target.value)}
          style={{
            width: "100%",
            padding: "8px 12px",
            marginBottom: "12px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontFamily: "inherit",
            fontSize: "14px",
          }}
        />
        <textarea
          placeholder="Содержимое второй формы"
          value={secondContent}
          onChange={(e) => setSecondContent(e.target.value)}
          style={{
            width: "100%",
            padding: "12px",
            marginBottom: "12px",
            border: "1px solid #ccc",
            borderRadius: "4px",
            fontFamily: "inherit",
            fontSize: "14px",
            minHeight: "120px",
            resize: "vertical",
          }}
        />
        <button
          onClick={handleSaveSecond}
          style={{
            padding: "8px 16px",
            backgroundColor: "#007bff",
            color: "white",
            border: "none",
            borderRadius: "4px",
            cursor: "pointer",
            fontSize: "14px",
          }}
        >
          Сохранить
        </button>
      </div>
    </>
  );
};

