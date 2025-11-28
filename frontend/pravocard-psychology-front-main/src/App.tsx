// src/App.tsx
import React from "react";
import { Routes, Route, Outlet } from "react-router-dom";
import { Sidebar } from "./components/Sidebar";
// import { PageHeader } from "./components/PageHeader";
import { Brain } from "./pages/Brain";
import { Sessions } from "./pages/Sessions";
import { Diagnostic } from "./pages/Diagnostic";
import { Messages } from "./pages/Messages";
import { Users } from "./pages/Users";
import AdminContext from './pages/AdminContext'; // Added import for AdminContext
import "./index.css";


const Layout: React.FC = () => {
  return (
    <div className="page">
      <header className="top-bar">Главная</header>

      <div className="layout">
        <Sidebar />

        <main className="content">
          <section className="forms">
            <Outlet />
          </section>
        </main>
      </div>
    </div>
  );
};

export const App: React.FC = () => {
  return (
    <Routes>
      <Route element={<Layout />}>
        <Route path="/brain" element={<Brain />} />
        <Route path="/sessions" element={<Sessions />} />
        <Route path="/diagnostic" element={<Diagnostic />} />
        <Route path="/messages" element={<Messages />} />
        <Route path="/users" element={<Users />} />
        <Route path="/admin/context" element={<AdminContext />} /> {/* Added route for AdminContext */}
        <Route path="/" element={<Messages />} />
      </Route>
    </Routes>
  );
};