import { BrowserRouter, Navigate, Route, Routes } from "react-router-dom";
import { ProtectedRoute, PublicOnlyRoute } from "./ProtectedRoute";
import { LoginPage } from "../pages/LoginPage";
import { DashboardPage } from "../pages/DashboardPage";
import { ScanReportPage } from "../pages/ScanReportPage";
import { WatchlistConfigPage } from "../pages/WatchlistConfigPage";
import { AccountConfigPage } from "../pages/AccountConfigPage";

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route
          path="/login"
          element={
            <PublicOnlyRoute>
              <LoginPage />
            </PublicOnlyRoute>
          }
        />

        <Route
          path="/"
          element={
            <ProtectedRoute>
              <DashboardPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/escaneo/:scanRunId"
          element={
            <ProtectedRoute>
              <ScanReportPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/configuracion/watchlist"
          element={
            <ProtectedRoute>
              <WatchlistConfigPage />
            </ProtectedRoute>
          }
        />

        <Route
          path="/configuracion/cuenta"
          element={
            <ProtectedRoute>
              <AccountConfigPage />
            </ProtectedRoute>
          }
        />

        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}
