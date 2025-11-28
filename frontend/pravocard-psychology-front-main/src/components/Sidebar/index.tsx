// src/Sidebar.tsx
import React from "react";
import { NavLink } from "react-router-dom";

const items = [
  { label: "МОЗГ", path: "/brain" },
  { label: "СЕССИИ", path: "/sessions" },
  { label: "ДИАГНОСТИКА", path: "/diagnostic" },
  { label: "ИСХОДЯЩИЕ СООБЩЕНИЯ", path: "/messages" },
  { label: "ПОЛЬЗОВАТЕЛИ", path: "/users" },
];

export const Sidebar: React.FC = () => {
  return (
    <aside className="sidebar">
      <nav>
        <ul className="sidebar-list">
          {items.map((item) => (
            <li key={item.label}>
              <NavLink
                to={item.path}
                className={({ isActive }) =>
                  `sidebar-item ${
                    isActive ? "sidebar-item--active" : "sidebar-item--disabled"
                  }`
                }
              >
                {item.label}
              </NavLink>
            </li>
          ))}
        </ul>
      </nav>
    </aside>
  );
};