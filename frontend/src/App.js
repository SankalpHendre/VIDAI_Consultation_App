// src/App.js
// Changes vs previous version:
//  • /room/:roomId is now a PUBLIC route — no PrivateRoute wrapper.
//  • "/" (login) is now a PUBLIC-ONLY route — authenticated users are
//    immediately redirected to their role dashboard so the browser Back
//    button can never take a logged-in user back to the login page.
//  • /thanks is a PUBLIC route for the post-feedback thank-you screen.

import React from "react";
import { BrowserRouter as Router, Routes, Route, Navigate, useLocation } from "react-router-dom";

import Login from "./components/Login";
import AdminHome from "./components/AdminHome";
import DoctorHome from "./components/DoctorHome";
import PatientHome from "./components/PatientHome";
import SalesHome from "./components/SalesHome";
import MeetingRoom from "./components/MeetingRoom";
import SubmitFeedback from "./components_friend/SubmitFeedback";

// ── Helper: map role → home path ─────────────────────────────────────────────
function roleHomePath(role) {
  if (role === "doctor") return "/doctor";
  if (role === "patient") return "/patient";
  if (role === "admin") return "/admin";
  if (role === "sales") return "/sales";
  return null;
}

// ── Guard: authenticated users only ──────────────────────────────────────────
function RoleRoute({ children, allowedRoles }) {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");
  const location = useLocation();

  if (!token) {
    const redirectUrl = location.pathname + location.search;
    localStorage.setItem("redirectAfterLogin", redirectUrl);
    return <Navigate to="/" replace />;
  }
  if (allowedRoles && !allowedRoles.includes(role)) return <Navigate to="/" replace />;
  return children;
}

// ── Guard: unauthenticated users only (login page) ───────────────────────────
// If a token already exists, send the user straight to their dashboard.
// This prevents the browser Back button from landing on the login screen.
function PublicOnlyRoute({ children }) {
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  if (token) {
    const home = roleHomePath(role);
    return <Navigate to={home || "/patient"} replace />;
  }
  return children;
}

export default function App() {
  return (
    <Router>
      <Routes>

        {/* Login — only accessible before authentication */}
        <Route path="/" element={<PublicOnlyRoute><Login /></PublicOnlyRoute>} />

        {/* Role-locked dashboards */}
        <Route path="/admin"   element={<RoleRoute allowedRoles={["admin"]}  ><AdminHome /></RoleRoute>} />
        <Route path="/doctor"  element={<RoleRoute allowedRoles={["doctor"]} ><DoctorHome /></RoleRoute>} />
        <Route path="/patient" element={<RoleRoute allowedRoles={["patient"]}><PatientHome /></RoleRoute>} />
        <Route path="/sales"   element={<RoleRoute allowedRoles={["sales"]}  ><SalesHome /></RoleRoute>} />

        {/* Public room route — MeetingRoom shows guest pre-join screen if not authed */}
        <Route path="/room/:roomId" element={<MeetingRoom />} />

        {/* Post-feedback thank-you screen — public so it works right after call ends */}
        <Route path="/thanks" element={<SubmitFeedback />} />

        <Route path="*" element={<CatchAllRedirect />} />

      </Routes>
    </Router>
  );
}

function CatchAllRedirect() {
  const location = useLocation();
  const token = localStorage.getItem("token");
  const role = localStorage.getItem("role");

  if (token) {
    // Logged-in user hit an unknown route → send home, don't go to login
    const home = roleHomePath(role);
    return <Navigate to={home || "/patient"} replace />;
  }

  const redirectUrl = location.pathname + location.search;
  if (redirectUrl !== "/" && redirectUrl !== "") {
    localStorage.setItem("redirectAfterLogin", redirectUrl);
  }
  return <Navigate to="/" replace />;
}